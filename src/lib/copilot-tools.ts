/**
 * Copilot AI Assistant — Read-Only Database Query Tools
 *
 * All tools are scoped to the authenticated user's data (userId).
 * Only read operations (findMany, findUnique, count, aggregate) are used.
 * No raw SQL, no mutations, no cross-tenant data access.
 */
import { z } from "zod";
import { eq, and, desc, asc, count, sql, sum, gte, lte, inArray, or, ilike, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users, clients, clientSubscriptions, subscriptions, plans, platforms, renewalLogs, platformRenewals, mutationAuditLogs } from "@/db/schema";
import { getDisciplineAnalytics } from "@/lib/discipline-service";
import { serializeDeletedClients } from "@/lib/client-deletion-snapshot";
import { createMutationToken } from "@/lib/mutation-token";
import { jsonToCsv } from "@/lib/csv-utils";
import { formatCurrency, centsToAmount } from "@/lib/currency";

// Type for defineTool — imported dynamically in route.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DefineToolFn = (...args: any[]) => any;

/**
 * Creates all read-only database tools scoped to a specific user.
 */
export function createUserScopedTools(
  defineTool: DefineToolFn,
  userId: string,
  allowDestructive: boolean = false
) {
  const tools = [
    // ──────────────────────────────────────────
    // 1. listClients — Search/list clients
    // ──────────────────────────────────────────
    defineTool("listClients", {
      description:
        "List or search the user's clients. Returns name, phone, notes, payment discipline info, and number of active subscriptions. Use this to find clients or get an overview.",
      parameters: z.object({
        search: z
          .string()
          .describe("Optional search term to filter by name or phone")
          .optional(),
        limit: z
          .number()
          .describe("Max results to return (default 20)")
          .optional(),
      }),
      handler: async ({
        search,
        limit = 20,
      }: {
        search?: string;
        limit?: number;
      }) => {
        const whereConditions = [eq(clients.userId, userId)];
        if (search) {
          whereConditions.push(or(
            ilike(clients.name, `%${search}%`),
            ilike(clients.phone, `%${search}%`),
            ilike(clients.notes, `%${search}%`)
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
              columns: { id: true },
            },
          },
          orderBy: [asc(clients.name)],
          limit: Math.min(limit, 50),
        });

        return {
          totalFound: clientsList.length,
          clients: clientsList.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            notes: c.notes,
            disciplineScore: c.disciplineScore ? Number(c.disciplineScore) : null,
            dailyPenalty: c.dailyPenalty ? Number(c.dailyPenalty) : 0.5,
            daysOverdue: c.daysOverdue,
            healthStatus: c.healthStatus || "New",
            activeSubscriptions: c.clientSubscriptions.length,
            createdAt: c.createdAt,
          })),
        };
      },
    }),

    // ──────────────────────────────────────────
    // 2. getClientDetails — Full client profile
    // ──────────────────────────────────────────
    defineTool("getClientDetails", {
      description:
        "Get full details for specific clients including all their active subscriptions (seats), payment discipline info, which platforms they're on, what they pay, and their recent payment history. Pass an array of clientIds to fetch multiple clients at once efficiently.",
      parameters: z.object({
        clientIds: z.union([z.string(), z.array(z.string())]).describe("A single client ID or an array of client IDs to fetch in bulk"),
      }),
      handler: async ({ clientIds }: { clientIds: string | string[] }) => {
        const ids = Array.isArray(clientIds) ? clientIds : [clientIds];
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

    // ──────────────────────────────────────────
    // 3. listPlatforms — All platforms with stats
    // ──────────────────────────────────────────
    defineTool("listPlatforms", {
      description:
        "List all platforms (Netflix, Spotify, etc.) with their plans, number of active subscriptions, total seats, and costs.",
      parameters: z.object({}),
      handler: async () => {
        const platformsList = await db.query.platforms.findMany({
          where: eq(platforms.userId, userId),
          orderBy: [asc(platforms.name)],
          with: {
            plans: {
              with: {
                subscriptions: {
                  with: {
                    clientSubscriptions: {
                      columns: { id: true, status: true },
                    },
                  },
                },
              },
            },
          },
        });

        return platformsList.map((p) => ({
          id: p.id,
          name: p.name,
          plans: p.plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            costPerMonth: Number(plan.cost),
            maxSeats: plan.maxSeats,
            isActive: plan.isActive,
            subscriptions: plan.subscriptions.map((sub) => ({
              id: sub.id,
              label: sub.label,
              status: sub.status,
              activeUntil: sub.activeUntil,
              seatsUsed: sub.clientSubscriptions.filter(cs => cs.status === "active").length,
            })),
          })),
        }));
      },
    }),

    // ──────────────────────────────────────────
    // 4. listSubscriptions — Subscriptions overview
    // ──────────────────────────────────────────
    defineTool("listSubscriptions", {
      description:
        "List all subscriptions with their platform, plan, seat usage, revenue from clients, and expiry dates. Use this for an overview of active groups/accounts.",
      parameters: z.object({
        status: z
          .enum(["active", "paused"])
          .describe("Filter by status")
          .optional(),
        platformName: z
          .string()
          .describe("Filter by platform name")
          .optional(),
      }),
      handler: async ({
        status,
        platformName,
      }: {
        status?: "active" | "paused";
        platformName?: string;
      }) => {
        const whereConditions = [eq(subscriptions.userId, userId)];
        if (status) whereConditions.push(eq(subscriptions.status, status));

        // For platformName filter, we need to get platform IDs first
        let platformIds: string[] | undefined;
        if (platformName) {
          const matchedPlatforms = await db.select({ id: platforms.id })
            .from(platforms)
            .where(ilike(platforms.name, `%${platformName}%`));
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

        // Filter by platform if needed (post-query filter since we can't filter nested)
        const filtered = platformIds
          ? subsList.filter(s => platformIds!.includes(s.plan.platformId))
          : subsList;

        return filtered.map((sub) => {
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
      },
    }),

    // ──────────────────────────────────────────
    // 5. getSubscriptionDetails — Full subscription
    // ──────────────────────────────────────────
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
          with: {
            plan: {
              with: { platform: { columns: { id: true, name: true } } },
            },
            clientSubscriptions: {
              orderBy: [desc(clientSubscriptions.joinedAt)],
              with: {
                client: { columns: { id: true, name: true, phone: true } },
              },
            },
            platformRenewals: {
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

        return { subscriptions: mappedSubs };
      },
    }),

    // ──────────────────────────────────────────
    // 6. getRevenueStats — Revenue analytics
    // ──────────────────────────────────────────
    defineTool("getRevenueStats", {
      description:
        "Get comprehensive revenue statistics: monthly recurring revenue (MRR), total platform costs, net profit, per-platform breakdown, and key metrics like total clients and seats.",
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

    // ──────────────────────────────────────────
    // 7. listPaymentHistory — Client payments
    // ──────────────────────────────────────────
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
        fromDate,
        toDate,
        limit = 20,
      }: {
        clientName?: string;
        fromDate?: string;
        toDate?: string;
        limit?: number;
      }) => {
        // Build conditions
        const conditions = [];

        // Filter by userId through subscription
        const userSubs = await db.select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId));
        const userSubIds = userSubs.map(s => s.id);
        if (userSubIds.length === 0) return { totalFound: 0, payments: [] };
        conditions.push(inArray(renewalLogs.clientSubscriptionId, userSubIds));

        // Filter by client name
        if (clientName) {
          const matchedClients = await db.select({ id: clients.id })
            .from(clients)
            .where(ilike(clients.name, `%${clientName}%`));
          const clientIds = matchedClients.map(c => c.id);
          if (clientIds.length === 0) return { totalFound: 0, payments: [] };
          // We need to filter through clientSubscriptions
          const matchedCS = await db.select({ id: clientSubscriptions.id })
            .from(clientSubscriptions)
            .where(inArray(clientSubscriptions.clientId, clientIds));
          const csIds = matchedCS.map(cs => cs.id);
          conditions.push(inArray(renewalLogs.clientSubscriptionId, csIds));
        }

        // Date filters
        if (fromDate) conditions.push(gte(renewalLogs.paidOn, fromDate));
        if (toDate) conditions.push(lte(renewalLogs.paidOn, toDate));

        const logs = await db.query.renewalLogs.findMany({
          where: and(...conditions),
          orderBy: [desc(renewalLogs.paidOn)],
          limit: Math.min(limit, 50),
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

    // ──────────────────────────────────────────
    // 8. listPlatformRenewals — Platform costs
    // ──────────────────────────────────────────
    defineTool("listPlatformRenewals", {
      description:
        "List recent platform renewal payments (what YOU pay to providers like Netflix, Spotify, etc.). Optionally filter by platform name or date range.",
      parameters: z.object({
        platformName: z
          .string()
          .describe("Filter by platform name")
          .optional(),
        fromDate: z
          .string()
          .describe("Start date (ISO format)")
          .optional(),
        toDate: z
          .string()
          .describe("End date (ISO format)")
          .optional(),
        limit: z.number().describe("Max results (default 20)").optional(),
      }),
      handler: async ({
        platformName,
        fromDate,
        toDate,
        limit = 20,
      }: {
        platformName?: string;
        fromDate?: string;
        toDate?: string;
        limit?: number;
      }) => {
        // Build conditions
        const conditions = [];

        // Filter by userId through subscription
        const userSubs = await db.select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId));
        const userSubIds = userSubs.map(s => s.id);
        if (userSubIds.length === 0) return { totalFound: 0, renewals: [] };
        conditions.push(inArray(platformRenewals.subscriptionId, userSubIds));

        // Filter by platform name
        if (platformName) {
          const matchedPlatforms = await db.select({ id: platforms.id })
            .from(platforms)
            .where(ilike(platforms.name, `%${platformName}%`));
          const platIds = matchedPlatforms.map(p => p.id);
          if (platIds.length === 0) return { totalFound: 0, renewals: [] };
          const matchedSubs = await db.select({ id: subscriptions.id })
            .from(subscriptions)
            .innerJoin(plans, eq(subscriptions.planId, plans.id))
            .where(inArray(plans.platformId, platIds));
          const subIds = matchedSubs.map(s => s.id);
          conditions.push(inArray(platformRenewals.subscriptionId, subIds));
        }

        // Date filters
        if (fromDate) conditions.push(gte(platformRenewals.paidOn, fromDate));
        if (toDate) conditions.push(lte(platformRenewals.paidOn, toDate));

        const renewals = await db.query.platformRenewals.findMany({
          where: and(...conditions),
          orderBy: [desc(platformRenewals.paidOn)],
          limit: Math.min(limit, 50),
          with: {
            subscription: {
              columns: { label: true },
              with: {
                plan: {
                  columns: { name: true },
                  with: { platform: { columns: { name: true } } }
                }
              },
            },
          },
        });

        return {
          totalFound: renewals.length,
          renewals: renewals.map((pr) => ({
            id: pr.id,
            platform: pr.subscription.plan.platform.name,
            plan: pr.subscription.plan.name,
            subscription: pr.subscription.label,
            amountPaid: Number(pr.amountPaid),
            periodStart: pr.periodStart,
            periodEnd: pr.periodEnd,
            paidOn: pr.paidOn,
          })),
        };
      },
    }),
    // ──────────────────────────────────────────
    // 9. getDisciplineScores — Worst/Best clients
    // ──────────────────────────────────────────
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

    // ──────────────────────────────────────────
    // 10. exportFinancialReport — Structured financial summary
    // ──────────────────────────────────────────
    defineTool("exportFinancialReport", {
      description: "Generate a structured financial report covering a date range. Returns totals for revenue collected from clients, platform costs paid, net profit, per-client breakdown, and per-platform breakdown. Ideal for end-of-month summaries.",
      parameters: z.object({
        fromDate: z.string().describe("Start date in ISO format (e.g. 2025-01-01)"),
        toDate: z.string().describe("End date in ISO format (e.g. 2025-01-31)"),
      }),
      handler: async ({ fromDate, toDate }: { fromDate: string; toDate: string }) => {
        // Get user's subscription IDs
        const userSubs = await db.select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId));
        const userSubIds = userSubs.map(s => s.id);
        if (userSubIds.length === 0) {
          return { period: { from: fromDate, to: toDate }, summary: { totalRevenueCollected: 0, totalPlatformCostsPaid: 0, netProfit: 0, totalMRR: 0, totalClientPayments: 0, totalPlatformPayments: 0 }, csvData: [], perClientBreakdown: [], perPlatformBreakdown: [], status: "download_available", message: "No data found.", filename: `reporte_financiero_${fromDate}_${toDate}.csv` };
        }

        const [clientPayments, platformPayments, activeSeats] = await Promise.all([
          db.query.renewalLogs.findMany({
            where: and(
              gte(renewalLogs.paidOn, fromDate),
              lte(renewalLogs.paidOn, toDate),
              inArray(renewalLogs.clientSubscriptionId, userSubIds)
            ),
            orderBy: [asc(renewalLogs.paidOn)],
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
          }),
          db.query.platformRenewals.findMany({
            where: and(
              gte(platformRenewals.paidOn, fromDate),
              lte(platformRenewals.paidOn, toDate),
              inArray(platformRenewals.subscriptionId, userSubIds)
            ),
            with: {
              subscription: {
                columns: { label: true },
                with: {
                  plan: {
                    columns: { name: true },
                    with: { platform: { columns: { name: true } } }
                  }
                },
              },
            },
          }),
          db.query.clientSubscriptions.findMany({
            where: and(
              eq(clientSubscriptions.status, "active"),
              inArray(clientSubscriptions.subscriptionId, userSubIds)
            ),
            columns: { customPrice: true },
            with: {
              subscription: {
                with: {
                  plan: {
                    with: { platform: { columns: { name: true } } }
                  }
                }
              }
            }
          }),
        ]);

        const totalRevenue = clientPayments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
        const totalCosts = platformPayments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
        const totalMRR = activeSeats.reduce((sum, s) => sum + Number(s.customPrice), 0);

        // Per client breakdown
        const perClient: Record<string, { name: string; totalPaid: number; payments: number }> = {};
        for (const p of clientPayments) {
          const name = p.clientSubscription?.client.name ?? "Unknown";
          if (!perClient[name]) perClient[name] = { name, totalPaid: 0, payments: 0 };
          perClient[name].totalPaid += Number(p.amountPaid);
          perClient[name].payments += 1;
        }

        // Per platform breakdown
        const perPlatform: Record<string, { platformName: string; revenueCollected: number; costsPaid: number }> = {};
        for (const p of clientPayments) {
          const pName = p.clientSubscription?.subscription.plan.platform.name ?? "Unknown";
          if (!perPlatform[pName]) perPlatform[pName] = { platformName: pName, revenueCollected: 0, costsPaid: 0 };
          perPlatform[pName].revenueCollected += Number(p.amountPaid);
        }
        for (const p of platformPayments) {
          const pName = p.subscription.plan.platform.name;
          if (!perPlatform[pName]) perPlatform[pName] = { platformName: pName, revenueCollected: 0, costsPaid: 0 };
          perPlatform[pName].costsPaid += Number(p.amountPaid);
        }

        return {
          period: { from: fromDate, to: toDate },
          summary: {
            totalRevenueCollected: totalRevenue,
            totalPlatformCostsPaid: totalCosts,
            netProfit: totalRevenue - totalCosts,
            totalMRR,
            totalClientPayments: clientPayments.length,
            totalPlatformPayments: platformPayments.length,
          },
          csvData: clientPayments.map(p => ({
            Date: p.paidOn ? new Date(p.paidOn).toLocaleDateString() : 'N/A',
            Client: p.clientSubscription?.client.name || 'Unknown',
            Platform: p.clientSubscription?.subscription.plan.platform.name || 'Unknown',
            Subscription: p.clientSubscription?.subscription.label || 'N/A',
            Amount: centsToAmount(p.amountPaid).toFixed(2),
            Period: `${p.periodStart ? new Date(p.periodStart).toLocaleDateString() : '?'} - ${p.periodEnd ? new Date(p.periodEnd).toLocaleDateString() : '?'}`,
            Notes: p.notes || ''
          })),
          status: "download_available",
          message: `Report generated for ${fromDate} to ${toDate}. Click below to download the CSV.`,
          filename: `reporte_financiero_${fromDate}_${toDate}.csv`,
          perClientBreakdown: Object.values(perClient).sort((a, b) => b.totalPaid - a.totalPaid),
          perPlatformBreakdown: Object.values(perPlatform).sort((a, b) => b.revenueCollected - a.revenueCollected),
        };
      },
    }),

    // ──────────────────────────────────────────
    // 11. exportClientsReport — Full client CSV export
    // ──────────────────────────────────────────
    defineTool("exportClientsReport", {
      description: "Export all client data into a single CSV file, including their contact info, discipline scores, and all active/paused subscriptions (platforms, plans, and prices). This is the best way to extract the full database of clients for external use.",
      parameters: z.object({}),
      handler: async () => {
        const clientsList = await db.query.clients.findMany({
          where: eq(clients.userId, userId),
          orderBy: [asc(clients.name)],
          with: {
            clientSubscriptions: {
              with: {
                subscription: {
                  with: {
                    plan: { with: { platform: true } },
                  },
                },
                renewalLogs: {
                  orderBy: [desc(renewalLogs.paidOn)],
                  limit: 1,
                },
              },
            },
          },
        });

        const rows: any[] = [];
        for (const client of clientsList) {
          if (client.clientSubscriptions.length === 0) {
            rows.push({
              "ID Cliente": client.id,
              "Nombre": client.name,
              "Teléfono": client.phone || "",
              "Notas": client.notes || "",
              "Score Disciplina": client.disciplineScore ? Number(client.disciplineScore).toFixed(1) : "N/A",
              "Estado Salud": client.healthStatus || "New",
              "Días Vencidos": client.daysOverdue,
              "Plataforma": "N/A",
              "Plan": "N/A",
              "Precio/Mes": "0.00",
              "Estado Suscripción": "N/A",
              "Activa Hasta": "N/A",
              "Último Pago": "N/A",
              "Fecha Registro": new Date(client.createdAt).toLocaleDateString(),
            });
          } else {
            for (const cs of client.clientSubscriptions) {
              const lastPayment = cs.renewalLogs[0];
              rows.push({
                "ID Cliente": client.id,
                "Nombre": client.name,
                "Teléfono": client.phone || "",
                "Notas": client.notes || "",
                "Score Disciplina": client.disciplineScore ? Number(client.disciplineScore).toFixed(1) : "N/A",
                "Estado Salud": client.healthStatus || "New",
                "Días Vencidos": client.daysOverdue,
                "Plataforma": cs.subscription.plan.platform.name,
                "Plan": cs.subscription.plan.name,
                "Precio/Mes": centsToAmount(cs.customPrice).toFixed(2),
                "Estado Suscripción": cs.status,
                "Activa Hasta": cs.activeUntil,
                "Último Pago": lastPayment ? lastPayment.paidOn : "Never",
                "Fecha Registro": new Date(client.createdAt).toLocaleDateString(),
              });
            }
          }
        }

        return {
          totalClients: clientsList.length,
          totalRows: rows.length,
          csvData: rows,
          status: "download_available",
          filename: `clientes_pearfect_${new Date().toISOString().split('T')[0]}.csv`,
          message: `Se han procesado ${clientsList.length} clientes con éxito. Haz clic abajo para descargar el archivo CSV.`,
        };
      },
    }),

    // ──────────────────────────────────────────
    // 12. generateWhatsappMessage — Build a WhatsApp link
    // ──────────────────────────────────────────
    defineTool("generateWhatsappMessage", {
      description: "Generate a clickable WhatsApp link to send a message to a client. Use this when the user asks to send a payment reminder, credentials update, or any custom message to a client via WhatsApp. Always fetch the client's phone number first. IMPORTANT: Never include emojis in the message — they cause rendering issues on some devices. Keep messages plain text only.",
      parameters: z.object({
        clientId: z.string().describe("The ID of the client to message."),
        messageType: z.enum(["payment_reminder", "credentials_update", "custom"]).describe("The type of message to compose."),
        customMessage: z.string().optional().describe("For 'custom' type: the exact message body to send. For other types, this will override the template."),
        amountDue: z.number().optional().describe("For payment_reminder: the amount owed."),
        platform: z.string().optional().describe("Platform name (for payment_reminder or credentials_update context)."),
        newUsername: z.string().optional().describe("For credentials_update: the new username/email."),
        newPassword: z.string().optional().describe("For credentials_update: the new password."),
        dueDate: z.string().optional().describe("For payment_reminder: the due date (ISO format)."),
      }),
      handler: async ({
        clientId, messageType, customMessage, amountDue, platform, newUsername, newPassword, dueDate,
      }: any) => {
        const client = await db.query.clients.findFirst({
          where: and(eq(clients.id, clientId), eq(clients.userId, userId)),
          columns: { name: true, phone: true },
        });
        if (!client) return { error: "Client not found or access denied." };
        if (!client.phone) return { error: `${client.name} does not have a phone number registered. Add one first.` };

        const me = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { companyName: true, name: true, whatsappSignatureMode: true }
        });
        const sigMode = me?.whatsappSignatureMode ?? "name";
        let senderName = "";
        if (sigMode === "company") {
          senderName = me?.companyName || me?.name || "";
        } else if (sigMode === "name") {
          senderName = me?.name || "";
        }
        
        const introPhrase = senderName 
          ? (sigMode === "company" ? `Hola, somos ${senderName}. ` : `Hola, soy ${senderName}. `) 
          : "Hola. ";

        // Normalize phone: strip spaces, dashes; if not starting with +, add +34 (Spain default)
        const rawPhone = client.phone.replace(/[\s\-()]/g, "");
        const phone = rawPhone.startsWith("+") ? rawPhone.replace("+", "") : `34${rawPhone}`;

        const signature = (sigMode !== "none" && senderName) 
          ? (sigMode === "company" ? `Gracias de parte del equipo de ${senderName}.` : `Gracias de parte de ${senderName}.`) 
          : "Gracias.";
  
        let messageBody = "";
        if (customMessage) {
          messageBody = customMessage;
        } else if (messageType === "payment_reminder") {
          const amountStr = amountDue != null ? formatCurrency(amountDue, "EUR") : "la cantidad pendiente";
          const dueDateStr = dueDate ? ` antes del ${new Date(dueDate).toLocaleDateString("es-ES")}` : "";
          const platformStr = platform ? ` de ${platform}` : "";
          messageBody = `${introPhrase}${client.name}, te recordamos que tu pago de ${amountStr}${platformStr} está pendiente${dueDateStr}. Por favor, realiza el pago lo antes posible.\n\n${signature}`;
        } else if (messageType === "credentials_update") {
          const platformStr = platform ? ` para ${platform}` : "";
          const userLine = newUsername ? `Usuario: ${newUsername}` : "";
          const passLine = newPassword ? `Contraseña: ${newPassword}` : "";
          const credLines = [userLine, passLine].filter(Boolean).join("\n");
          messageBody = `${introPhrase}${client.name}, tus credenciales de acceso${platformStr} han sido actualizadas.\n${credLines}\nPor favor, actualízalas en tu dispositivo. Contáctanos si necesitas ayuda.\n\n${signature}`;
        } else {
          messageBody = `${introPhrase}${client.name}.\n\n${signature}`;
        }

        // Encode for URL
        const encodedMessage = encodeURIComponent(messageBody);
        const whatsappLink = `https://wa.me/${phone}?text=${encodedMessage}`;

        return {
          clientName: client.name,
          phone: client.phone,
          messageType,
          messageBody,
          whatsappLink,
          instructions: "Click the link above to open WhatsApp with this message pre-filled. Review and send from your device.",
        };
      },
    }),

    // ──────────────────────────────────────────
    // 13. getAccountDetails — Get user's own profile and credits
    // ──────────────────────────────────────────
    defineTool("getAccountDetails", {
      description: "Get the authenticated user's own account details, including their usage credits, discipline penalty settings, currency, email, and total counts of clients/subscriptions. Use this if the user asks about their own account, credits, or settings.",
      parameters: z.object({}),
      handler: async () => {
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: {
            name: true,
            email: true,
            createdAt: true,
            currency: true,
            disciplinePenalty: true,
            companyName: true,
            whatsappSignatureMode: true,
            usageCredits: true,
          },
          with: {
            clients: { columns: { id: true } },
            subscriptions: { columns: { id: true } },
            platforms: { columns: { id: true } },
          },
        });
        
        if (!user) return { error: "User account not found." };
        
        return {
          profile: {
            name: user.name,
            email: user.email,
            memberSince: user.createdAt,
          },
          settings: {
            currency: user.currency,
            dailyDisciplinePenalty: Number(user.disciplinePenalty),
            companyName: user.companyName,
            whatsappSignatureMode: user.whatsappSignatureMode,
          },
          usage: {
            availableCredits: Number(user.usageCredits),
            totalClients: user.clients.length,
            totalSubscriptions: user.subscriptions.length,
            totalPlatforms: user.platforms.length,
          }
        };
      }
    }),

    // ──────────────────────────────────────────
    // 13. generateCsvExport — Generic JSON → CSV download (client-side conversion)
    // ──────────────────────────────────────────
    defineTool("generateCsvExport", {
      description: "Convert any JSON data into a downloadable CSV file directly in the browser. Use this whenever the user asks for a CSV, Excel, or data export of ANY kind — platforms, subscriptions, clients, payments, custom views, etc. You MUST first fetch the data using the appropriate read tools (listClients, listSubscriptions, listPlatforms, etc.), then pass the relevant fields as a JSON array to this tool. You control the exact columns: only include what the user asked for. DO NOT use bash, python, or any other method — this is the ONLY way to generate CSVs.",
      parameters: z.object({
        data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe("Array of objects to export. Each object's keys become column headers, values become cells. All values must be primitive (string, number, boolean, or null)."),
        filename: z.string().optional().describe("Base filename without extension (e.g. 'clientes_marzo'). Date will be appended automatically."),
        title: z.string().optional().describe("Short human-readable description shown in the chat, e.g. 'Reporte de clientes con pagos vencidos'."),
      }),
      handler: async ({ data, filename, title }: any) => {
        if (!Array.isArray(data) || data.length === 0) {
          return { error: "No data provided for export. Please fetch data first using a read tool and pass it here." };
        }
        const safeFilename = `${(filename || "export").replace(/[^a-z0-9_\-]/gi, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
        return {
          status: "download_available",
          csvData: data,
          filename: safeFilename,
          message: title || `Export ready: ${data.length} row(s).`,
          rowCount: data.length,
          columnCount: Object.keys(data[0] || {}).length,
        };
      },
    }),

  ];


  if (!allowDestructive) {
    tools.push(
      defineTool("undoMutation", {
        description: "This tool is informational only. Undo is handled directly by the UI via a secure backend endpoint. If the user asks to undo something, tell them to use the 'Ir Atrás' button shown after each executed mutation.",
        parameters: z.object({}),
        handler: async () => ({
          message: "Undo is handled directly by the UI. Use the 'Ir Atrás' button that appears after each confirmed change."
        })
      })
    );
    return tools;
  }

  // ALLOW DESTRUCTIVE MODE ENABLED - Add all mutation tools
  tools.push(
    defineTool("updateUserConfig", {
      description: "Propose an update to the authenticated user's account settings, including currency, discipline penalty, company name, and WhatsApp signature mode.",
      parameters: z.object({
        currency: z.enum(["EUR", "USD", "GBP", "CNY"]).optional().describe("The base currency for all monetary displays."),
        disciplinePenalty: z.number().min(0).max(5).optional().describe("Daily score deduction applied for each late day."),
        companyName: z.string().max(100).optional().describe("The name of the user's company or business, used in WhatsApp messages."),
        whatsappSignatureMode: z.enum(["none", "name", "company"]).optional(),
      }),
      handler: async ({ disciplinePenalty, currency, companyName, whatsappSignatureMode }: any) => {
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { name: true, currency: true, disciplinePenalty: true, companyName: true, whatsappSignatureMode: true }
        });
        if (!user) return { error: "User not found." };
        const pendingChanges = { 
          ...(disciplinePenalty !== undefined ? { disciplinePenalty } : {}), 
          ...(currency ? { currency } : {}),
          ...(companyName !== undefined ? { companyName } : {}),
          ...(whatsappSignatureMode !== undefined ? { whatsappSignatureMode } : {})
        };
        const { token, expiresAt } = await createMutationToken(userId, { 
          toolName: "updateUserConfig", 
          targetId: userId, 
          action: "update", 
          changes: pendingChanges, 
          previousValues: { 
            disciplinePenalty: user.disciplinePenalty, 
            currency: user.currency, 
            companyName: user.companyName, 
            whatsappSignatureMode: user.whatsappSignatureMode 
          } 
        });
        await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
        return { status: "requires_confirmation", __token: token, expiresAt, message: "I am ready to update your configuration.", pendingChanges };
      },
    }),

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
        const sub = await db.query.subscriptions.findFirst({ where: and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)) });
        if (!client || !sub) return { error: "Client or Subscription not found." };
        const pendingChanges = { clientId, subscriptionId, customPrice, activeUntil, joinedAt, serviceUser, servicePassword };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "assignClientToSubscription", action: "create", changes: pendingChanges, previousValues: null });
        await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
        return { status: "requires_confirmation", __token: token, expiresAt, message: `I'm ready to assign **${client.name}** to **${sub.label}**.`, pendingChanges };
      },
    }),

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

    // --- BULK AND POTENTIALLY DESTRUCTIVE TOOLS ---
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

    defineTool("removeClientsFromSubscription", {
      description: "Propose unassigning one or multiple clients from their seat(s).",
      parameters: z.object({
        clientSubscriptionIds: z.array(z.string()).describe("An array of ClientSubscription pivot record IDs to delete."),
      }),
      handler: async ({ clientSubscriptionIds }: any) => {
        // Get user's client IDs first
        const userClients = await db.select({ id: clients.id }).from(clients).where(eq(clients.userId, userId));
        const userClientIds = userClients.map(c => c.id);
        if (userClientIds.length === 0) return { error: "Client subscriptions not found or access denied." };

        const css = await db.query.clientSubscriptions.findMany({
          where: and(
            inArray(clientSubscriptions.id, clientSubscriptionIds),
            inArray(clientSubscriptions.clientId, userClientIds)
          ),
          with: {
            client: { columns: { name: true } },
            subscription: { columns: { label: true } },
            renewalLogs: true,
          }
        });
        if (!css.length) return { error: "Client subscriptions not found or access denied." };
        
        const previousValues = css.map(c => ({
            id: c.id, clientId: c.clientId, subscriptionId: c.subscriptionId, customPrice: c.customPrice,
            activeUntil: c.activeUntil, joinedAt: c.joinedAt, leftAt: c.leftAt ?? null,
            status: c.status, remainingDays: c.remainingDays ?? null, serviceUser: c.serviceUser ?? null, servicePassword: c.servicePassword ?? null,
            renewalLogs: c.renewalLogs.map(rl => ({
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
        }));

        const pendingChanges = { clientSubscriptionIds };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "removeClientsFromSubscription", targetId: "bulk", action: "delete", changes: pendingChanges, previousValues: previousValues as any });
        await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
        return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to remove ${css.length} seat assignment(s).`, pendingChanges };
      },
    }),

    defineTool("managePlatforms", {
      description: "Creates, updates, or bulk-deletes platforms based on the provided operation.",
      parameters: z.object({
        operation: z.enum(["create", "update", "delete"]),
        platformIds: z.array(z.string()).optional().describe("For 'delete', provide array of platform IDs. For 'update', provide exactly 1 ID."),
        name: z.string().optional().describe("For 'create' or 'update'."),
      }),
      handler: async ({ operation, platformIds, name }: any) => {
        const pendingChanges = { operation, platformIds, name };
        // Get previous state if updating/deleting
        let previousValues: any = null;
        if (operation === "delete" && platformIds) {
            const platformsList = await db.query.platforms.findMany({
              where: and(inArray(platforms.id, platformIds), eq(platforms.userId, userId))
            });
            previousValues = platformsList.map(p => ({ id: p.id, name: p.name }));
        } else if (operation === "update" && platformIds && platformIds[0]) {
            const p = await db.query.platforms.findFirst({
              where: and(eq(platforms.id, platformIds[0]), eq(platforms.userId, userId))
            });
            previousValues = p ? [{ id: p.id, name: p.name }] : [];
        }

        const { token, expiresAt } = await createMutationToken(userId, { toolName: "managePlatforms", action: operation as any, changes: pendingChanges, previousValues });
        await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
        return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to ${operation} platform(s).`, pendingChanges };
      },
    }),

    defineTool("managePlans", {
      description: "Creates, updates, or bulk-deletes plans.",
      parameters: z.object({
        operation: z.enum(["create", "update", "delete"]),
        planIds: z.array(z.string()).optional().describe("For 'delete' array, for 'update' single ID."),
        platformId: z.string().optional().describe("For 'create'"),
        name: z.string().optional(),
        cost: z.number().optional(),
        maxSeats: z.number().optional(),
        isActive: z.boolean().optional(),
      }),
      handler: async ({ operation, planIds, platformId, name, cost, maxSeats, isActive }: any) => {
        const pendingChanges = { operation, planIds, platformId, name, cost, maxSeats, isActive };
        let previousValues: any = null;
        if (operation === "delete" && planIds) {
            // Get plans through platform's userId
            const userPlatforms = await db.select({ id: platforms.id }).from(platforms).where(eq(platforms.userId, userId));
            const userPlatformIds = userPlatforms.map(p => p.id);
            const plansList = await db.query.plans.findMany({
              where: and(inArray(plans.id, planIds), inArray(plans.platformId, userPlatformIds))
            });
            previousValues = plansList;
        } else if (operation === "update" && planIds && planIds[0]) {
            const userPlatforms = await db.select({ id: platforms.id }).from(platforms).where(eq(platforms.userId, userId));
            const userPlatformIds = userPlatforms.map(p => p.id);
            const p = await db.query.plans.findFirst({
              where: and(eq(plans.id, planIds[0]), inArray(plans.platformId, userPlatformIds))
            });
            previousValues = p ? [p] : [];
        }
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "managePlans", action: operation as any, changes: pendingChanges, previousValues });
        await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
        return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to ${operation} plan(s).`, pendingChanges };
      },
    }),

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

    defineTool("undoMutation", {
      description: "This tool is informational only. Undo is handled directly by the UI via a secure backend endpoint.",
      parameters: z.object({}),
      handler: async () => ({ message: "Undo is handled directly by the UI. Use the 'Ir Atrás' button that appears after each confirmed change." })
    })
  );

  return tools;
}
