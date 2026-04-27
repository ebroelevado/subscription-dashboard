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
import { sanitizeData } from "@/lib/data-utils";

type DefineToolFn = (...args: any[]) => any;

export function getSubscriptionTools(defineTool: DefineToolFn, userId: string, allowDestructive: boolean = false) {
  const tools = [];

  tools.push(
    defineTool("listSubscriptions", {
          description:
            "List all subscriptions with their platform, plan, seat usage, revenue from clients, and expiry dates. Use this for an overview of active groups/accounts.",
          parameters: z.object({
            status: z
              .enum(["active", "paused", "all"])
              .describe("Filter by status. Use 'all' to include all statuses.")
              .optional(),
            platformName: z
              .string()
              .describe("Filter by platform name (partial, case-insensitive)")
              .optional(),
          }),
          handler: async ({
            status,
            platformName,
          }: {
            status?: "active" | "paused" | "all";
            platformName?: string;
          }) => {
            const whereConditions = [eq(subscriptions.userId, userId)];
            if (status && status !== "all") whereConditions.push(eq(subscriptions.status, status));
    
            // For platformName filter, we need to get platform IDs first
            let platformIds: string[] | undefined;
            if (platformName) {
              const matchedPlatforms = await db.select({ id: platforms.id })
                .from(platforms)
                .where(and(
                  eq(platforms.userId, userId),
                  like(sql`lower(${platforms.name})`, `%${platformName.toLowerCase()}%`)
                ));
              platformIds = matchedPlatforms.map(p => p.id);
              if (platformIds.length === 0) return [];
            }
    
            const subsList = await db.query.subscriptions.findMany({
              where: and(...whereConditions),
              orderBy: [desc(subscriptions.createdAt)],
              with: {
                plan: {
                  columns: { id: true, name: true, cost: true, maxSeats: true, platformId: true },
                  with: { platform: { columns: { id: true, name: true } } },
                },
                clientSubscriptions: {
                  where: eq(clientSubscriptions.status, "active"),
                  columns: { customPrice: true },
                },
                owner: { columns: { name: true } },
              },
            });
    
            const filtered = platformIds
              ? subsList.filter(s => platformIds!.includes(s.plan.platformId))
              : subsList;
    
            const results = filtered.map((sub) => {
              const monthlyRevenue = sub.clientSubscriptions.reduce(
                (sum, cs) => sum + Number(cs.customPrice),
                0,
              );
              const seatsUsed = sub.clientSubscriptions.length;
              return {
                id: sub.id,
                label: sub.label,
                platform: sub.plan.platform.name,
                plan: sub.plan.name,
                planCost: Number(sub.plan.cost),
                maxSeats: sub.plan.maxSeats,
                seatsUsed,
                status: sub.status,
                activeUntil: sub.activeUntil,
                monthlyRevenue,
                profit: monthlyRevenue - Number(sub.plan.cost),
                owner: sub.owner?.name || null,
                masterUsername: sub.masterUsername,
              };
            });

            return sanitizeData(results);
          },
        }),
    
  );

  tools.push(
    defineTool("getSubscriptionDetails", {
          description:
            "Get full details of subscriptions including all assigned client seats, credentials, and recent platform renewals. Pass an array of subscriptionIds to fetch multiple at once efficiently.",
          parameters: z.object({
            subscriptionIds: z.union([z.string(), z.array(z.string())]).describe("A single subscription ID or an array of subscription IDs to fetch in bulk"),
          }),
          handler: async ({ subscriptionIds }: { subscriptionIds: string | string[] }) => {
            const ids = Array.isArray(subscriptionIds) ? subscriptionIds : [subscriptionIds];
            const subs = await db.query.subscriptions.findMany({
              where: and(inArray(subscriptions.id, ids), eq(subscriptions.userId, userId)),
              columns: {
                id: true,
                label: true,
                status: true,
                startDate: true,
                activeUntil: true,
                masterUsername: true,
                masterPassword: true,
                ownerId: true,
                planId: true,
              },
              with: {
                plan: {
                  columns: { id: true, name: true, cost: true, maxSeats: true },
                  with: { platform: { columns: { id: true, name: true } } },
                },
                clientSubscriptions: {
                  orderBy: [desc(clientSubscriptions.joinedAt)],
                  columns: {
                    id: true,
                    status: true,
                    customPrice: true,
                    activeUntil: true,
                    joinedAt: true,
                    serviceUser: true,
                    servicePassword: true,
                  },
                  with: {
                    client: { columns: { id: true, name: true, phone: true } },
                  },
                },
                platformRenewals: {
                  columns: { id: true, amountPaid: true, periodStart: true, periodEnd: true, paidOn: true },
                  orderBy: [desc(platformRenewals.paidOn)],
                  limit: 5,
                },
                owner: { columns: { name: true, phone: true } },
              },
            });
    
            if (!subs.length) return { error: "No subscriptions found or access denied" };
    
            const mappedSubs = subs.map(sub => ({
              id: sub.id,
              label: sub.label,
              platform: sub.plan.platform.name,
              plan: sub.plan.name,
              planCost: Number(sub.plan.cost),
              maxSeats: sub.plan.maxSeats,
              status: sub.status,
              startDate: sub.startDate,
              activeUntil: sub.activeUntil,
              masterUsername: sub.masterUsername,
              masterPassword: sub.masterPassword,
              owner: sub.owner,
              seats: sub.clientSubscriptions.map((cs) => ({
                seatId: cs.id,
                clientName: cs.client.name,
                clientPhone: cs.client.phone,
                clientId: cs.client.id,
                price: Number(cs.customPrice),
                status: cs.status,
                serviceUser: cs.serviceUser,
                servicePassword: cs.servicePassword,
                activeUntil: cs.activeUntil,
                joinedAt: cs.joinedAt,
              })),
              recentPlatformPayments: sub.platformRenewals.map((pr) => ({
                amount: Number(pr.amountPaid),
                periodStart: pr.periodStart,
                periodEnd: pr.periodEnd,
                paidOn: pr.paidOn,
              })),
            }));
    
            return sanitizeData({ subscriptions: mappedSubs });
          },
        }),
    
  );

  if (allowDestructive) {
    tools.push(
      defineTool("manageSubscriptions", {
            description: "Creates, updates, or bulk-deletes subscriptions.",
            parameters: z.object({
              operation: z.enum(["create", "update", "delete"]),
              subscriptionIds: z.array(z.string()).optional(),
              planId: z.string().optional(),
              label: z.string().optional(),
              status: z.string().optional(),
              startDate: z.string().optional(),
              activeUntil: z.string().optional(),
              masterUsername: z.string().optional(),
              masterPassword: z.string().optional(),
            }),
            handler: async ({ operation, subscriptionIds, planId, label, status, startDate, activeUntil, masterUsername, masterPassword }: any) => {
              const pendingChanges = { operation, subscriptionIds, planId, label, status, startDate, activeUntil, masterUsername, masterPassword };
              let previousValues: any = null;
              if (operation === "delete" && subscriptionIds) {
                  const subsList = await db.query.subscriptions.findMany({
                      where: and(inArray(subscriptions.id, subscriptionIds), eq(subscriptions.userId, userId)),
                      with: {
                          clientSubscriptions: {
                              with: { renewalLogs: true },
                          },
                          platformRenewals: true,
                      },
                  });
                  previousValues = subsList.map(sub => ({
                      id: sub.id,
                      userId: sub.userId,
                      planId: sub.planId,
                      label: sub.label,
                      startDate: sub.startDate,
                      activeUntil: sub.activeUntil,
                      status: sub.status,
                      isAutopayable: sub.isAutopayable,
                      createdAt: sub.createdAt,
                      masterUsername: sub.masterUsername ?? null,
                      masterPassword: sub.masterPassword ?? null,
                      defaultPaymentNote: sub.defaultPaymentNote ?? null,
                      ownerId: sub.ownerId ?? null,
                      clientSubscriptions: sub.clientSubscriptions.map(cs => ({
                          id: cs.id,
                          clientId: cs.clientId,
                          subscriptionId: cs.subscriptionId,
                          customPrice: cs.customPrice,
                          activeUntil: cs.activeUntil,
                          joinedAt: cs.joinedAt,
                          leftAt: cs.leftAt ?? null,
                          status: cs.status,
                          remainingDays: cs.remainingDays ?? null,
                          serviceUser: cs.serviceUser ?? null,
                          servicePassword: cs.servicePassword ?? null,
                          renewalLogs: cs.renewalLogs.map(rl => ({
                              id: rl.id,
                              clientSubscriptionId: rl.clientSubscriptionId,
                              amountPaid: rl.amountPaid,
                              expectedAmount: rl.expectedAmount,
                              periodStart: rl.periodStart,
                              periodEnd: rl.periodEnd,
                              paidOn: rl.paidOn,
                              dueOn: rl.dueOn,
                              monthsRenewed: rl.monthsRenewed,
                              notes: rl.notes ?? null,
                              createdAt: rl.createdAt,
                          })),
                      })),
                      platformRenewals: sub.platformRenewals.map(pr => ({
                          id: pr.id,
                          subscriptionId: pr.subscriptionId,
                          amountPaid: pr.amountPaid,
                          periodStart: pr.periodStart,
                          periodEnd: pr.periodEnd,
                          paidOn: pr.paidOn,
                          notes: pr.notes ?? null,
                          createdAt: pr.createdAt,
                      })),
                  }));
              } else if (operation === "update" && subscriptionIds && subscriptionIds[0]) {
                  const p = await db.query.subscriptions.findFirst({
                    where: and(eq(subscriptions.id, subscriptionIds[0]), eq(subscriptions.userId, userId))
                  });
                  previousValues = p ? [p] : [];
              }
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "manageSubscriptions", action: operation as any, changes: pendingChanges, previousValues });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to ${operation} subscription(s).`, pendingChanges };
            },
          }),
      
    );
    tools.push(
      defineTool("bulkManageSeats", {
            description: "Propose pausing or resuming multiple client seats (ClientSubscriptions) at once. Use this to pause all expired or non-paying clients, or to resume a group. Always list the seats first to get their IDs.",
            parameters: z.object({
              operation: z.enum(["pause", "resume"]).describe("Whether to pause or resume the seats."),
              clientSubscriptionIds: z.array(z.string()).describe("Array of ClientSubscription IDs to act on."),
              reason: z.string().optional().describe("Optional reason for the bulk action, shown in the confirmation."),
            }),
            handler: async ({ operation, clientSubscriptionIds, reason }: any) => {
              // Get user's client IDs
              const userClients = await db.select({ id: clients.id }).from(clients).where(eq(clients.userId, userId));
              const userClientIds = userClients.map(c => c.id);
              if (userClientIds.length === 0) return { error: "No seats found or access denied." };
      
              const seats = await db.query.clientSubscriptions.findMany({
                where: and(
                  inArray(clientSubscriptions.id, clientSubscriptionIds),
                  inArray(clientSubscriptions.clientId, userClientIds)
                ),
                with: {
                  client: { columns: { name: true } },
                  subscription: { columns: { label: true } }
                },
              });
              if (!seats.length) return { error: "No seats found or access denied." };
      
              const previousValues = seats.map((s) => ({
                id: s.id,
                clientName: s.client.name,
                subscriptionLabel: s.subscription.label,
                status: s.status,
              }));
      
              const pendingChanges = { operation, clientSubscriptionIds, reason };
              const { token, expiresAt } = await createMutationToken(userId, {
                toolName: "bulkManageSeats",
                targetId: "bulk",
                action: "update",
                changes: pendingChanges,
                previousValues: previousValues as any,
              });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
      
              const clientNames = seats.slice(0, 3).map((s) => s.client.name).join(", ");
              const more = seats.length > 3 ? ` and ${seats.length - 3} more` : "";
      
              return {
                status: "requires_confirmation",
                __token: token,
                expiresAt,
                message: `I am ready to **${operation}** ${seats.length} seat(s): ${clientNames}${more}.${reason ? ` Reason: ${reason}` : ""}`,
                pendingChanges,
              };
            },
          }),
      
    );
  }
  return tools;
}
