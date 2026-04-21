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

export function getFinancialTools(defineTool: DefineToolFn, userId: string, allowDestructive: boolean = false) {
  const tools = [];

  tools.push(
    defineTool("getRevenueStats", {
          description:
            "Get comprehensive revenue statistics: monthly recurring revenue (MRR), total platform costs, net profit, and per-platform breakdown. Use this as the data source for revenue-related questions or before generating revenue CSV exports.",
          parameters: z.object({}),
          handler: async () => {
            // Optimize: Use DB aggregations instead of downloading all rows
            const [
              mrrResult,
              totalClientsResult,
              activeSeatsResult,
              platformsList,
              activeSubs
            ] = await Promise.all([
              db.select({ total: sum(clientSubscriptions.customPrice) })
                .from(clientSubscriptions)
                .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
                .where(and(
                  eq(subscriptions.userId, userId),
                  eq(clientSubscriptions.status, "active")
                )),
              db.select({ count: count() }).from(clients).where(eq(clients.userId, userId)),
              db.select({ count: count() })
                .from(clientSubscriptions)
                .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
                .where(and(
                  eq(subscriptions.userId, userId),
                  eq(clientSubscriptions.status, "active")
                )),
              db.query.platforms.findMany({
                where: eq(platforms.userId, userId),
                with: {
                  plans: {
                    columns: { id: true, name: true, cost: true },
                    with: {
                      subscriptions: {
                        where: eq(subscriptions.status, "active"),
                        columns: { id: true },
                        with: {
                          clientSubscriptions: {
                            where: eq(clientSubscriptions.status, "active"),
                            columns: { customPrice: true },
                          },
                        },
                      },
                    },
                  },
                },
              }),
              db.query.subscriptions.findMany({
                where: and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")),
                with: { plan: { columns: { cost: true } } },
              }),
            ]);
    
            const totalMRR = Number(mrrResult[0]?.total || 0);
            const totalClients = totalClientsResult[0]?.count || 0;
            const activeSeatsCount = activeSeatsResult[0]?.count || 0;
            const totalCosts = activeSubs.reduce((sum, s) => sum + Number(s.plan.cost), 0);
    
            const perPlatform = platformsList.map((p) => {
              let revenue = 0;
              let costs = 0;
              let activeSeats = 0;
              let activeSubsCount = 0;
    
              for (const plan of p.plans) {
                  for (const sub of plan.subscriptions) {
                      costs += Number(plan.cost);
                      activeSubsCount++;
                      for (const cs of sub.clientSubscriptions) {
                          revenue += Number(cs.customPrice);
                          activeSeats++;
                      }
                  }
              }
    
              return {
                platform: p.name,
                revenue,
                costs,
                activeSeats,
                activeSubscriptions: activeSubsCount,
              };
            });
    
            return {
              totalMRR,
              totalCosts,
              netProfit: totalMRR - totalCosts,
              profitMargin: totalMRR > 0 ? `${((1 - totalCosts / totalMRR) * 100).toFixed(1)}%` : "N/A",
              totalClients,
              totalActiveSeats: activeSeatsCount,
              perPlatform,
            };
          },
        }),
    
  );

  tools.push(
    defineTool("listPaymentHistory", {
          description:
            "List recent payment records from clients. Optionally filter by client name or a date range. Shows amount paid, period covered, and payment date.",
          parameters: z.object({
            clientName: z
              .string()
              .describe("Filter by client name")
              .optional(),
            fromDate: z
              .string()
              .describe("Start date (ISO format, e.g. 2025-01-01)")
              .optional(),
            toDate: z
              .string()
              .describe("End date (ISO format, e.g. 2025-12-31)")
              .optional(),
            limit: z.number().describe("Max results (default 20)").optional(),
          }),
          handler: async ({
            clientName,
            platformName,
            fromDate,
            toDate,
            limit = 20,
          }: {
            clientName?: string;
            platformName?: string;
            fromDate?: string;
            toDate?: string;
            limit?: number;
          }) => {
            // Build conditions
            const conditions = [];
    
            // Filter by userId: renewalLogs → clientSubscriptions → subscriptions → userId
            const userSubs = await db.select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.userId, userId));
            const userSubIds = userSubs.map(s => s.id);
            if (userSubIds.length === 0) return { totalFound: 0, payments: [] };
            // Get clientSubscription IDs that belong to this user's subscriptions
            const userCS = await db.select({ id: clientSubscriptions.id })
              .from(clientSubscriptions)
              .where(inArray(clientSubscriptions.subscriptionId, userSubIds));
            const userCSIds = userCS.map(cs => cs.id);
            if (userCSIds.length === 0) return { totalFound: 0, payments: [] };
            conditions.push(inArray(renewalLogs.clientSubscriptionId, userCSIds));
    
            // Filter by client name
            if (clientName) {
              const matchedClients = await db.select({ id: clients.id })
                .from(clients)
                .where(like(sql`lower(${clients.name})`, `%${clientName.toLowerCase()}%`));
              const clientIds = matchedClients.map(c => c.id);
              if (clientIds.length === 0) return { totalFound: 0, payments: [] };
              // We need to filter through clientSubscriptions
              const matchedCS = await db.select({ id: clientSubscriptions.id })
                .from(clientSubscriptions)
                .where(inArray(clientSubscriptions.clientId, clientIds));
              const csIds = matchedCS.map(cs => cs.id);
              conditions.push(inArray(renewalLogs.clientSubscriptionId, csIds));
            }
    
            // Filter by platform name
            if (platformName) {
              const matchedPlatforms = await db.select({ id: platforms.id })
                .from(platforms)
                .where(and(
                  eq(platforms.userId, userId),
                  like(sql`lower(${platforms.name})`, `%${platformName.toLowerCase()}%`)
                ));
              if (matchedPlatforms.length === 0) return { totalFound: 0, payments: [] };
              const platSubIds = await db.select({ id: subscriptions.id })
                .from(subscriptions)
                .innerJoin(plans, eq(subscriptions.planId, plans.id))
                .where(inArray(plans.platformId, matchedPlatforms.map(p => p.id)));
              const platCSIds = await db.select({ id: clientSubscriptions.id })
                .from(clientSubscriptions)
                .where(inArray(clientSubscriptions.subscriptionId, platSubIds.map(s => s.id)));
              conditions.push(inArray(renewalLogs.clientSubscriptionId, platCSIds.map(cs => cs.id)));
            }
    
            // Date filters
            if (fromDate) conditions.push(gte(renewalLogs.paidOn, fromDate));
            if (toDate) conditions.push(lte(renewalLogs.paidOn, toDate));
    
            const logs = await db.query.renewalLogs.findMany({
              where: and(...conditions),
              orderBy: [desc(renewalLogs.paidOn)],
              limit: Math.min(limit, 100),
              with: {
                clientSubscription: {
                  columns: { id: true },
                  with: {
                    client: { columns: { name: true } },
                    subscription: {
                      columns: { label: true },
                      with: {
                        plan: {
                          columns: { name: true },
                          with: { platform: { columns: { name: true } } }
                        }
                      }
                    },
                  },
                },
              },
            });
    
            return {
              totalFound: logs.length,
              payments: logs.map((rl) => ({
                id: rl.id,
                clientName: rl.clientSubscription?.client.name || "Unknown",
                platform: rl.clientSubscription?.subscription.plan.platform.name || "Unknown",
                subscription: rl.clientSubscription?.subscription.label || "N/A",
                amountPaid: Number(rl.amountPaid),
                expectedAmount: Number(rl.expectedAmount),
                periodStart: rl.periodStart,
                periodEnd: rl.periodEnd,
                paidOn: rl.paidOn,
                dueOn: rl.dueOn,
                monthsRenewed: rl.monthsRenewed,
                notes: rl.notes,
              })),
            };
          },
        }),
    
  );

  tools.push(
    defineTool("getDisciplineScores", {
          description:
            "Get pre-calculated payment discipline scores (0.0 to 10.0) for every client. MUST use this to find 'worst clients' (scores < 5.0), 'best clients', or anyone owing money instantly, WITHOUT downloading raw payment histories.",
          parameters: z.object({}),
          handler: async () => {
            // Fetch detailed stats calculated by the engine
            const analytics = await getDisciplineAnalytics(userId);
    
            // Fetch clients with persisted metrics to map IDs to Names and Phones
            const clientsList = await db.query.clients.findMany({
                where: eq(clients.userId, userId),
                columns: {
                    id: true,
                    name: true,
                    phone: true,
                    disciplineScore: true,
                    healthStatus: true,
                    daysOverdue: true,
                    dailyPenalty: true,
                },
            });
    
            const results = clientsList.map((c) => {
                const stats = analytics.perClient[c.id] || {};
                return {
                    clientId: c.id,
                    name: c.name,
                    phone: c.phone || "Unknown",
                    score: c.disciplineScore ? Number(c.disciplineScore) : null,
                    healthStatus: c.healthStatus || "New",
                    daysOverdue: c.daysOverdue,
                    dailyPenalty: c.dailyPenalty ? Number(c.dailyPenalty) : 0.5,
                    avgDaysLate: stats.avgDaysLate || 0,
                    totalPayments: stats.totalPayments || 0,
                    lateCount: stats.lateCount || 0,
                    onTimeRate: stats.onTimeRate ?? 100,
                    pendingAmount: stats.pendingAmount || 0,
                    isUnpaid: stats.isUnpaid || false
                };
            });
    
            // Sort worst to best by default to prioritize answering "worst clients"
            results.sort((a, b) => {
                if (a.healthStatus === "Critical" && b.healthStatus !== "Critical") return -1;
                if (a.healthStatus !== "Critical" && b.healthStatus === "Critical") return 1;
                if (a.score === null) return 1;
                if (b.score === null) return -1;
                return a.score - b.score;
            });
    
            return {
                globalStats: analytics.global,
                totalClients: results.length,
                clientsRanking: results
            };
          },
        }),
    
  );

  if (allowDestructive) {
    tools.push(
      defineTool("logPayment", {
            description: "Propose registering a new payment received from a client.",
            parameters: z.object({
              clientSubscriptionId: z.string().describe("The ID of the client's seat/subscription (Not the client ID)."),
              amountPaid: z.number().describe("The amount paid by the client."),
              monthsRenewed: z.number().default(1).describe("Number of months the payment covers."),
              paidOn: z.string().optional().describe("Date of payment (ISO format). Defaults to today."),
              notes: z.string().optional().describe("Optional notes for the payment."),
            }),
            handler: async ({ clientSubscriptionId, amountPaid, monthsRenewed, paidOn, notes }: any) => {
              const cs = await db.query.clientSubscriptions.findFirst({
                where: eq(clientSubscriptions.id, clientSubscriptionId),
                with: {
                  client: { columns: { name: true } },
                  subscription: {
                    columns: { userId: true },
                    with: { plan: { with: { platform: true } } }
                  }
                }
              });
              if (!cs || cs.subscription.userId !== userId) return { error: "Client subscription not found or access denied." };
              const pendingChanges = { clientSubscriptionId, amountPaid, monthsRenewed, paidOn, notes };
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "logPayment", action: "create", changes: pendingChanges, previousValues: { activeUntil: cs.activeUntil } });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt,           message: `I'm ready to register a payment of ${formatCurrency(amountPaid, "EUR")} from ${cs.client.name}.`, pendingChanges };
            },
          }),
      
    );
    tools.push(
      defineTool("managePayments", {
            description: "Propose updating or deleting an existing client payment record (RenewalLog). Use 'update' to correct the amount, date, notes, or period of a payment. Use 'delete' to remove a mistaken or duplicate payment. Always call listPaymentHistory first to get the payment ID.",
            parameters: z.object({
              operation: z.enum(["update", "delete"]).describe("The operation to perform."),
              paymentId: z.string().describe("The ID of the RenewalLog record to modify."),
              amountPaid: z.number().optional().describe("New amount paid (for update)."),
              paidOn: z.string().optional().describe("New payment date in ISO format (for update)."),
              notes: z.string().optional().describe("New notes (for update)."),
              periodStart: z.string().optional().describe("New period start date in ISO format (for update)."),
              periodEnd: z.string().optional().describe("New period end date in ISO format (for update)."),
            }),
            handler: async ({ operation, paymentId, amountPaid, paidOn, notes, periodStart, periodEnd }: any) => {
              // Get user's subscription IDs
              const userSubs = await db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.userId, userId));
              const userSubIds = userSubs.map(s => s.id);
              if (userSubIds.length === 0) return { error: "Payment record not found or access denied." };
      
              // Get client subscription IDs for this user
              const userCS = await db.select({ id: clientSubscriptions.id }).from(clientSubscriptions).where(inArray(clientSubscriptions.subscriptionId, userSubIds));
              const userCSIds = userCS.map(cs => cs.id);
      
              const payment = await db.query.renewalLogs.findFirst({
                where: and(
                  eq(renewalLogs.id, paymentId),
                  inArray(renewalLogs.clientSubscriptionId, userCSIds)
                ),
                with: {
                  clientSubscription: {
                    with: {
                      client: { columns: { name: true } },
                      subscription: {
                        columns: { label: true },
                        with: {
                          plan: {
                            with: { platform: { columns: { name: true } } }
                          }
                        }
                      },
                    },
                  },
                },
              });
              if (!payment) return { error: "Payment record not found or access denied." };
      
              const clientName = payment.clientSubscription?.client.name ?? "Unknown";
              const platform = payment.clientSubscription?.subscription.plan.platform.name ?? "Unknown";
      
              const previousValues = {
                id: payment.id,
                amountPaid: Number(payment.amountPaid),
                expectedAmount: Number(payment.expectedAmount),
                paidOn: payment.paidOn,
                periodStart: payment.periodStart,
                periodEnd: payment.periodEnd,
                notes: payment.notes,
                clientSubscriptionId: payment.clientSubscriptionId,
              };
      
              const pendingChanges = { operation, paymentId, amountPaid, paidOn, notes, periodStart, periodEnd };
              const { token, expiresAt } = await createMutationToken(userId, {
                toolName: "managePayments",
                targetId: paymentId,
                action: operation === "delete" ? "delete" : "update",
                changes: pendingChanges,
                previousValues,
              });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
      
              if (operation === "delete") {
                return {
                  status: "requires_confirmation",
                  __token: token,
                  expiresAt,
                  message: `I am ready to **permanently delete** the payment of ${formatCurrency(payment.amountPaid, "EUR")} from **${clientName}** (${platform}) paid on ${payment.paidOn}.`,
                  pendingChanges,
                };
              }
      
              return {
                status: "requires_confirmation",
                __token: token,
                expiresAt,
                message: `I am ready to update the payment of **${clientName}** (${platform}).`,
                pendingChanges,
              };
            },
          }),
      
    );
  }
  return tools;
}
