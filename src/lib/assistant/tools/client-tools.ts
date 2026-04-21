import { z } from "zod";
import { eq, and, desc, asc, count, sql, sum, gte, lte, inArray, or, like, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users, clients, clientSubscriptions, subscriptions, plans, platforms, renewalLogs, platformRenewals, mutationAuditLogs } from "@/db/schema";
import { getDisciplineAnalytics } from "@/lib/discipline-service";
import { serializeDeletedClients } from "@/lib/client-deletion-snapshot";
import { createMutationToken } from "@/lib/mutation-token";
import { jsonToCsv } from "@/lib/csv-utils";
import { formatCurrency, centsToAmount } from "@/lib/currency";
import { preparePythonAnalysis as preparePython, pythonAnalysisTemplateIds } from "@/lib/python-analysis";

type DefineToolFn = (...args: any[]) => any;

export function getClientTools(defineTool: DefineToolFn, userId: string, allowDestructive: boolean = false) {
  const tools = [];

  tools.push(
    defineTool("listClients", {
          description:
            "List or search the user's clients. Returns name, phone, notes, payment discipline info, and number of active subscriptions. Use this FIRST to find clients or get an overview. If a specific search fails, try a broader partial search (e.g. 'Ang' instead of 'Angel').",
          parameters: z.object({
            search: z
              .string()
              .describe("Optional search term to filter by name, phone or notes")
              .optional(),
            limit: z
              .number()
              .describe("Max results to return (default 20, max 100)")
              .optional(),
            onlyWithoutActiveSubscriptions: z
              .boolean()
              .describe("If true, return only clients that have NO active seats (useful to find abandoned or new clients)")
              .optional(),
          }),
          handler: async ({
            search,
            limit = 20,
            onlyWithoutActiveSubscriptions,
          }: {
            search?: string;
            limit?: number;
            onlyWithoutActiveSubscriptions?: boolean;
          }) => {
            const whereConditions = [eq(clients.userId, userId)];
            if (search) {
              whereConditions.push(or(
                like(sql`lower(${clients.name})`, `%${search.toLowerCase()}%`),
                like(sql`lower(${clients.phone})`, `%${search.toLowerCase()}%`),
                like(sql`lower(${clients.notes})`, `%${search.toLowerCase()}%`)
              )!);
            }
    
            const clientsList = await db.query.clients.findMany({
              where: and(...whereConditions),
              columns: {
                 id: true,
                 name: true,
                 phone: true,
                 notes: true,
                 createdAt: true,
                 disciplineScore: true,
                 dailyPenalty: true,
                 daysOverdue: true,
                 healthStatus: true,
              },
              with: {
                clientSubscriptions: {
                  columns: { id: true, status: true },
                },
              },
              orderBy: [asc(clients.name)],
              limit: Math.min(limit, 100),
            });
    
            // Post-filter: only clients with no active seats
            const filtered = onlyWithoutActiveSubscriptions
              ? clientsList.filter((c) => !c.clientSubscriptions.some((cs) => cs.status === "active"))
              : clientsList;
    
            return {
              totalFound: filtered.length,
              limitApplied: Math.min(limit, 100),
              note: filtered.length === Math.min(limit, 100) ? "Result may be truncated. Increase `limit` or use `search` to narrow results." : undefined,
              clients: filtered.map((c) => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                notes: c.notes,
                disciplineScore: c.disciplineScore ? Number(c.disciplineScore) : null,
                dailyPenalty: c.dailyPenalty ? Number(c.dailyPenalty) : 0.5,
                daysOverdue: c.daysOverdue,
                healthStatus: c.healthStatus || "New",
                activeSubscriptions: c.clientSubscriptions.filter((cs) => cs.status === "active").length,
                pausedSubscriptions: c.clientSubscriptions.filter((cs) => cs.status === "paused").length,
                createdAt: c.createdAt,
              })),
            };
          },
        }),
    
  );

  tools.push(
    defineTool("getClientDetails", {
          description:
            "Get full details for specific clients including all their active subscriptions (seats), payment discipline info, platforms, pricing, and payment history. Pass an array of clientIds to fetch multiple clients at once efficiently. REQUIRED before proposing any modifications to specific clients.",
          parameters: z.object({
            clientIds: z.union([z.string(), z.array(z.string())]).describe("A single client ID or an array of client IDs to fetch in bulk"),
          }),
          handler: async ({ clientIds }: { clientIds: string | string[] }) => {
            const ids = Array.isArray(clientIds) ? clientIds : [clientIds];
            if (ids.length > 10) {
              return { error: `Token limit protection: You requested ${ids.length} clients at once. Please request a maximum of 10 clients per tool call to avoid exceeding the model's context window.` };
            }
            
            const clientsList = await db.query.clients.findMany({
              where: and(inArray(clients.id, ids), eq(clients.userId, userId)),
              columns: {
                id: true,
                name: true,
                phone: true,
                notes: true,
                createdAt: true,
                disciplineScore: true,
                dailyPenalty: true,
                daysOverdue: true,
                healthStatus: true,
              },
              with: {
                clientSubscriptions: {
                  columns: {
                    id: true,
                    status: true,
                    customPrice: true,
                    activeUntil: true,
                    joinedAt: true,
                  },
                  with: {
                    subscription: {
                      columns: { label: true },
                      with: {
                        plan: {
                          columns: { name: true },
                          with: { platform: { columns: { name: true } } }
                        }
                      }
                    },
                    renewalLogs: {
                      columns: { amountPaid: true, periodStart: true, periodEnd: true, paidOn: true },
                      orderBy: [desc(renewalLogs.paidOn)],
                      limit: 5,
                    },
                  },
                },
                ownedSubscriptions: {
                  columns: { id: true, label: true },
                },
              },
            });
    
            if (!clientsList.length) return { error: "No clients found or access denied" };
    
            const mappedClients = clientsList.map((client) => ({
              id: client.id,
              name: client.name,
              phone: client.phone,
              notes: client.notes,
              disciplineScore: client.disciplineScore ? Number(client.disciplineScore) : null,
              dailyPenalty: client.dailyPenalty ? Number(client.dailyPenalty) : 0.5,
              daysOverdue: client.daysOverdue,
              healthStatus: client.healthStatus || "New",
              createdAt: client.createdAt,
              subscriptions: client.clientSubscriptions.map((cs) => ({
                seatId: cs.id,
                platform: cs.subscription.plan.platform.name,
                plan: cs.subscription.plan.name,
                subscriptionLabel: cs.subscription.label,
                status: cs.status,
                pricePerMonth: Number(cs.customPrice),
                activeUntil: cs.activeUntil,
                joinedAt: cs.joinedAt,
                recentPayments: cs.renewalLogs.map((rl) => ({
                  amount: Number(rl.amountPaid),
                  periodStart: rl.periodStart,
                  periodEnd: rl.periodEnd,
                  paidOn: rl.paidOn,
                })),
              })),
              ownedSubscriptions: client.ownedSubscriptions,
            }));
    
            return { clients: mappedClients };
          },
        }),
    
  );

  if (allowDestructive) {
    tools.push(
      defineTool("createClient", {
            description: "Propose creating a new client profile.",
            parameters: z.object({
              name: z.string().describe("The full name of the client."),
              phone: z.string().optional().describe("Optional phone number."),
              notes: z.string().optional().describe("Optional notes."),
            }),
            handler: async ({ name, phone, notes }: any) => {
              const pendingChanges = { name, phone, notes };
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "createClient", action: "create", changes: pendingChanges, previousValues: null });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: `I'm ready to create a new client profile for **${name}**.`, pendingChanges };
            },
          }),
      
    );
    tools.push(
      defineTool("updateClient", {
            description: "Propose an update to a client's information (name, phone, notes).",
            parameters: z.object({
              clientId: z.string().describe("The ID of the client to update."),
              name: z.string().optional().describe("New name for the client."),
              phone: z.string().optional().describe("New phone number."),
              notes: z.string().optional().describe("New notes/comments."),
            }),
            handler: async ({ clientId, name, phone, notes }: any) => {
              const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.userId, userId)) });
              if (!client) return { error: "Client not found or access denied." };
              const pendingChanges = { name, phone, notes };
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "updateClient", targetId: clientId, action: "update", changes: pendingChanges, previousValues: { name: client.name, phone: client.phone, notes: client.notes } });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: `I'm ready to update client ${client.name}.`, pendingChanges };
            },
          }),
      
    );
    tools.push(
      defineTool("deleteClients", {
            description: "Propose the COMPLETE and PERMANENT deletion of one or multiple clients. MUST narrate client info before calling.",
            parameters: z.object({
              clientIds: z.array(z.string()).describe("An array of client IDs to delete."),
            }),
            handler: async ({ clientIds }: any) => {
              const clientsList = await db.query.clients.findMany({
                where: and(inArray(clients.id, clientIds), eq(clients.userId, userId)),
                with: {
                  clientSubscriptions: {
                    with: {
                      renewalLogs: true,
                    },
                  },
                  ownedSubscriptions: {
                    columns: { id: true },
                  },
                },
              });
              if (!clientsList.length) return { error: "Clients not found or access denied." };
      
              const previousValues = serializeDeletedClients(clientsList as any);
      
              const pendingChanges = { clientIds };
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "deleteClients", targetId: "bulk", action: "delete", changes: pendingChanges, previousValues: previousValues as any });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to permanently delete ${clientsList.length} client(s): ${clientsList.map((c) => c.name).join(", ")}.`, pendingChanges };
            },
          }),
      
    );
    tools.push(
      defineTool("assignClientToSubscription", {
            description: "Propose assigning a client to a subscription group (seat).",
            parameters: z.object({
              clientId: z.string().describe("The ID of the client."),
              subscriptionId: z.string().describe("The ID of the subscription group (instance of a plan)."),
              customPrice: z.number().describe("The price the client pays for this seat."),
              activeUntil: z.string().describe("ISO date until which the seat is paid for."),
              joinedAt: z.string().optional().describe("ISO date of joining. Defaults to today."),
              serviceUser: z.string().optional().describe("Username/Profile name in the service."),
              servicePassword: z.string().optional().describe("Password for this profile."),
            }),
            handler: async ({ clientId, subscriptionId, customPrice, activeUntil, joinedAt, serviceUser, servicePassword }: any) => {
              const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.userId, userId)) });
              const sub = await db.query.subscriptions.findFirst({
                where: and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)),
                with: { plan: { columns: { maxSeats: true } } }
              });
              if (!client) return { error: `Client not found or access denied.` };
              if (!sub) return { error: `Subscription not found or access denied.` };
      
              // Check for duplicate: client already in this subscription?
              const existingSeat = await db.query.clientSubscriptions.findFirst({
                where: and(
                  eq(clientSubscriptions.clientId, clientId),
                  eq(clientSubscriptions.subscriptionId, subscriptionId)
                )
              });
              if (existingSeat) {
                return { error: `${client.name} is already assigned to "${sub.label}" (seat status: ${existingSeat.status}). To change the price or status, use bulkManageSeats or managePayments instead.` };
              }
      
              // Check seat capacity
              if (sub.plan.maxSeats !== null && sub.plan.maxSeats !== undefined) {
                const [{ count: activeCount }] = await db
                  .select({ count: count() })
                  .from(clientSubscriptions)
                  .where(and(
                    eq(clientSubscriptions.subscriptionId, subscriptionId),
                    eq(clientSubscriptions.status, "active")
                  ));
                if (activeCount >= sub.plan.maxSeats) {
                  return { error: `"${sub.label}" is full: ${activeCount}/${sub.plan.maxSeats} active seats occupied. To add more clients, first remove an existing seat or upgrade the plan's maxSeats.` };
                }
              }
      
              const pendingChanges = { clientId, subscriptionId, customPrice, activeUntil, joinedAt, serviceUser, servicePassword };
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "assignClientToSubscription", action: "create", changes: pendingChanges, previousValues: null });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: `I'm ready to assign **${client.name}** to **${sub.label}**.`, pendingChanges };
            },
          }),
      
    );
    tools.push(
      defineTool("removeClientsFromSubscription", {
            description: "Propose unassigning one or multiple clients from their seat(s).",
            parameters: z.object({
              clientSubscriptionIds: z.array(z.string()).describe("An array of ClientSubscription pivot record IDs to delete."),
            }),
            handler: async ({ clientSubscriptionIds }: any) => {
              // Verify ownership via subscription → userId (more efficient than fetching all client IDs)
              const userSubIds = await db
                .select({ id: subscriptions.id })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId))
                .then(rows => rows.map(r => r.id));
              if (userSubIds.length === 0) return { error: "Client subscriptions not found or access denied." };
      
              const css = await db.query.clientSubscriptions.findMany({
                where: and(
                  inArray(clientSubscriptions.id, clientSubscriptionIds),
                  inArray(clientSubscriptions.subscriptionId, userSubIds)
                ),
                with: {
                  client: { columns: { name: true } },
                  subscription: { columns: { label: true } },
                  renewalLogs: { columns: { id: true } },
                }
              });
              if (!css.length) return { error: "Client subscriptions not found or access denied." };
      
              // Build snapshot for undo
              const fullCss = await db.query.clientSubscriptions.findMany({
                where: inArray(clientSubscriptions.id, css.map(c => c.id)),
                with: { renewalLogs: true },
              });
              const previousValues = fullCss.map(c => ({
                  id: c.id, clientId: c.clientId, subscriptionId: c.subscriptionId, customPrice: c.customPrice,
                  activeUntil: c.activeUntil, joinedAt: c.joinedAt, leftAt: c.leftAt ?? null,
                  status: c.status, remainingDays: c.remainingDays ?? null, serviceUser: c.serviceUser ?? null, servicePassword: c.servicePassword ?? null,
                  renewalLogs: c.renewalLogs.map(rl => ({
                      id: rl.id, clientSubscriptionId: rl.clientSubscriptionId, amountPaid: rl.amountPaid, expectedAmount: rl.expectedAmount,
                      periodStart: rl.periodStart, periodEnd: rl.periodEnd, paidOn: rl.paidOn, dueOn: rl.dueOn,
                      monthsRenewed: rl.monthsRenewed, notes: rl.notes ?? null, createdAt: rl.createdAt,
                  })),
              }));
      
              const totalPaymentRecords = fullCss.reduce((sum, c) => sum + c.renewalLogs.length, 0);
              const seatSummary = css.map(c => `${c.client.name} (${c.subscription.label})`).join(", ");
      
              const pendingChanges = { clientSubscriptionIds };
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "removeClientsFromSubscription", targetId: "bulk", action: "delete", changes: pendingChanges, previousValues: previousValues as any });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return {
                status: "requires_confirmation",
                __token: token,
                expiresAt,
                message: `I am ready to remove ${css.length} seat assignment(s): ${seatSummary}. This will also delete ${totalPaymentRecords} associated payment record(s).`,
                pendingChanges,
              };
            },
          }),
      
    );
  }
  return tools;
}
