/**
 * Copilot AI Assistant — Read-Only Database Query Tools
 *
 * All tools are scoped to the authenticated user's data (userId).
 * Only read operations (findMany, findUnique, count, aggregate) are used.
 * No raw SQL, no mutations, no cross-tenant data access.
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDisciplineAnalytics } from "@/lib/discipline-service";
import { serializeDeletedClients } from "@/lib/client-deletion-snapshot";
import { createMutationToken } from "@/lib/mutation-token";
import { jsonToCsv } from "@/lib/csv-utils";

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
        const clients = await prisma.client.findMany({
          where: {
            userId,
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { phone: { contains: search, mode: "insensitive" } },
                    { notes: { contains: search, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
          select: {
             id: true,
             name: true,
             phone: true,
             notes: true,
             createdAt: true,
             disciplineScore: true,
             dailyPenalty: true,
             daysOverdue: true,
             healthStatus: true,
             _count: { select: { clientSubscriptions: true } },
          },
          orderBy: { name: "asc" },
          take: Math.min(limit, 50),
        });

        return {
          totalFound: clients.length,
          clients: clients.map((c: any) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            notes: c.notes,
            disciplineScore: c.disciplineScore ? Number(c.disciplineScore) : null,
            dailyPenalty: c.dailyPenalty ? Number(c.dailyPenalty) : 0.5,
            daysOverdue: c.daysOverdue,
            healthStatus: c.healthStatus || "New",
            activeSubscriptions: c._count.clientSubscriptions,
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
        const clients = await prisma.client.findMany({
          where: { id: { in: ids }, userId },
          select: {
            id: true,
            name: true,
            phone: true,
            notes: true,
            createdAt: true,
            disciplineScore: true,
            dailyPenalty: true,
            daysOverdue: true,
            healthStatus: true,
            clientSubscriptions: {
              select: {
                id: true,
                status: true,
                customPrice: true,
                activeUntil: true,
                joinedAt: true,
                subscription: {
                  select: {
                    label: true,
                    plan: {
                      select: {
                        name: true,
                        platform: { select: { name: true } }
                      }
                    }
                  }
                },
                renewalLogs: {
                  select: { amountPaid: true, periodStart: true, periodEnd: true, paidOn: true },
                  orderBy: { paidOn: "desc" },
                  take: 5,
                },
              },
            },
            ownedSubscriptions: {
              select: { id: true, label: true },
            },
          },
        });

        if (!clients.length) return { error: "No clients found or access denied" };

        const mappedClients = clients.map((client: any) => ({
          id: client.id,
          name: client.name,
          phone: client.phone,
          notes: client.notes,
          disciplineScore: client.disciplineScore ? Number(client.disciplineScore) : null,
          dailyPenalty: client.dailyPenalty ? Number(client.dailyPenalty) : 0.5,
          daysOverdue: client.daysOverdue,
          healthStatus: client.healthStatus || "New",
          createdAt: client.createdAt,
          subscriptions: client.clientSubscriptions.map((cs: any) => ({
            seatId: cs.id,
            platform: cs.subscription.plan.platform.name,
            plan: cs.subscription.plan.name,
            subscriptionLabel: cs.subscription.label,
            status: cs.status,
            pricePerMonth: Number(cs.customPrice),
            activeUntil: cs.activeUntil,
            joinedAt: cs.joinedAt,
            recentPayments: cs.renewalLogs.map((rl: any) => ({
              amount: Number(rl.amountPaid),
              periodStart: rl.periodStart,
              periodEnd: rl.periodEnd,
              paidOn: rl.paidOn,
            })),
          })),
          ownedSubscriptions: client.ownedSubscriptions,
        }));

        // Return a single object if only one ID was requested to retain backward feel, though returning array is fine too.
        // Returning array always is more predictable for bulk operations.
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
        const platforms = await prisma.platform.findMany({
          where: { userId },
          include: {
            plans: {
              include: {
                subscriptions: {
                  include: {
                    _count: {
                      select: { clientSubscriptions: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { name: "asc" },
        });

        return platforms.map((p) => ({
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
              seatsUsed: sub._count.clientSubscriptions,
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
        const subscriptions = await prisma.subscription.findMany({
          where: {
            userId,
            ...(status ? { status } : {}),
            ...(platformName
              ? {
                  plan: {
                    platform: {
                      name: { contains: platformName, mode: "insensitive" },
                    },
                  },
                }
              : {}),
          },
          include: {
            plan: { include: { platform: true } },
            clientSubscriptions: {
              where: { status: "active" },
              select: { customPrice: true },
            },
            _count: { select: { clientSubscriptions: true } },
            owner: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
        });

        return subscriptions.map((sub) => {
          const monthlyRevenue = sub.clientSubscriptions.reduce(
            (sum, cs) => sum + Number(cs.customPrice),
            0,
          );
          return {
            id: sub.id,
            label: sub.label,
            platform: sub.plan.platform.name,
            plan: sub.plan.name,
            planCost: Number(sub.plan.cost),
            maxSeats: sub.plan.maxSeats,
            seatsUsed: sub._count.clientSubscriptions,
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
        const subs = await prisma.subscription.findMany({
          where: { id: { in: ids }, userId },
          include: {
            plan: { include: { platform: true } },
            clientSubscriptions: {
              include: {
                client: { select: { id: true, name: true, phone: true } },
              },
              orderBy: { joinedAt: "desc" },
            },
            platformRenewals: {
              orderBy: { paidOn: "desc" },
              take: 5,
            },
            owner: { select: { name: true, phone: true } },
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
            serviceUser: (cs as any).serviceUser,
            servicePassword: (cs as any).servicePassword,
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
          mrrAgg,
          costAgg,
          totalClients,
          activeSeatsCount,
          platforms
        ] = await Promise.all([
          prisma.clientSubscription.aggregate({
            where: { status: "active", subscription: { userId } },
            _sum: { customPrice: true }
          }),
          prisma.subscription.aggregate({
            where: { status: "active", userId },
            // Prisma aggregate on relations sum is tricky, let's fetch active subscriptions with their plans
            // Actually, we'll keep the subscription fetch but ONLY the cost
          }).catch(() => null), // Catch just in case
          prisma.client.count({ where: { userId } }),
          prisma.clientSubscription.count({ 
            where: { status: "active", subscription: { userId } } 
          }),
          prisma.platform.findMany({
            where: { userId },
            select: {
              name: true,
              plans: {
                select: {
                  cost: true,
                  subscriptions: {
                    where: { status: "active" },
                    select: {
                      clientSubscriptions: {
                        where: { status: "active" },
                        select: { customPrice: true }
                      }
                    }
                  }
                }
              }
            }
          })
        ]);

        // Fallback for costs if aggregate isn't perfectly supported on relations in this prisma version
        const activeSubs = await prisma.subscription.findMany({
            where: { userId, status: "active" },
            select: { plan: { select: { cost: true } } },
        });

        const totalMRR = Number(mrrAgg._sum.customPrice || 0);
        const totalCosts = activeSubs.reduce((sum, s) => sum + Number(s.plan.cost), 0);

        const perPlatform = platforms.map((p) => {
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
        const logs = await prisma.renewalLog.findMany({
          where: {
            clientSubscription: {
              subscription: { userId },
              ...(clientName
                ? {
                    client: {
                      name: { contains: clientName, mode: "insensitive" },
                    },
                  }
                : {}),
            },
            ...(fromDate || toDate
              ? {
                  paidOn: {
                    ...(fromDate ? { gte: new Date(fromDate) } : {}),
                    ...(toDate ? { lte: new Date(toDate) } : {}),
                  },
                }
              : {}),
          },
          include: {
            clientSubscription: {
              include: {
                client: { select: { name: true } },
                subscription: {
                  select: {
                    label: true,
                    plan: {
                      select: {
                        platform: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { paidOn: "desc" },
          take: Math.min(limit, 50),
        });

        return {
          totalFound: logs.length,
          payments: logs.map((rl) => ({
            id: rl.id,
            clientName: rl.clientSubscription?.client.name || "Unknown",
            platform:
              rl.clientSubscription?.subscription.plan.platform.name ||
              "Unknown",
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
        const renewals = await prisma.platformRenewal.findMany({
          where: {
            subscription: {
              userId,
              ...(platformName
                ? {
                    plan: {
                      platform: {
                        name: {
                          contains: platformName,
                          mode: "insensitive",
                        },
                      },
                    },
                  }
                : {}),
            },
            ...(fromDate || toDate
              ? {
                  paidOn: {
                    ...(fromDate ? { gte: new Date(fromDate) } : {}),
                    ...(toDate ? { lte: new Date(toDate) } : {}),
                  },
                }
              : {}),
          },
          include: {
            subscription: {
              select: {
                label: true,
                plan: {
                  select: {
                    name: true,
                    platform: { select: { name: true } },
                  },
                },
              },
            },
          },
          orderBy: { paidOn: "desc" },
          take: Math.min(limit, 50),
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
        const clients = await (prisma.client as any).findMany({
            where: { userId },
            select: {
                id: true,
                name: true,
                phone: true,
                disciplineScore: true,
                healthStatus: true,
                daysOverdue: true,
                dailyPenalty: true
            }
        });

        const results = clients.map((c: any) => {
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
        results.sort((a: any, b: any) => {
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
        const from = new Date(fromDate);
        const to = new Date(toDate);

        const [clientPayments, platformPayments, activeSeats] = await Promise.all([
          prisma.renewalLog.findMany({
            where: {
              paidOn: { gte: from, lte: to },
              clientSubscription: { subscription: { userId } },
            },
            include: {
              clientSubscription: {
                include: {
                  client: { select: { name: true } },
                  subscription: { select: { label: true, plan: { select: { platform: { select: { name: true } } } } } },
                },
              },
            },
            orderBy: { paidOn: "asc" },
          }),
          prisma.platformRenewal.findMany({
            where: {
              paidOn: { gte: from, lte: to },
              subscription: { userId },
            },
            include: {
              subscription: {
                select: { label: true, plan: { select: { name: true, platform: { select: { name: true } } } } },
              },
            },
          }),
          prisma.clientSubscription.findMany({
            where: { status: "active", subscription: { userId } },
            select: { customPrice: true, subscription: { select: { plan: { select: { platform: { select: { name: true } } } } } } },
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
            Amount: Number(p.amountPaid).toFixed(2),
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
        const clients = await prisma.client.findMany({
          where: { userId },
          include: {
            clientSubscriptions: {
              include: {
                subscription: {
                  include: {
                    plan: { include: { platform: true } },
                  },
                },
                renewalLogs: {
                  orderBy: { paidOn: "desc" },
                  take: 1,
                },
              },
            },
          },
          orderBy: { name: "asc" },
        });

        const rows: any[] = [];
        for (const client of clients) {
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
              "Fecha Registro": client.createdAt.toLocaleDateString(),
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
                "Precio/Mes": Number(cs.customPrice).toFixed(2),
                "Estado Suscripción": cs.status,
                "Activa Hasta": cs.activeUntil.toLocaleDateString(),
                "Último Pago": lastPayment ? lastPayment.paidOn.toLocaleDateString() : "Never",
                "Fecha Registro": client.createdAt.toLocaleDateString(),
              });
            }
          }
        }

        return {
          totalClients: clients.length,
          totalRows: rows.length,
          csvData: rows,
          status: "download_available",
          filename: `clientes_pearfect_${new Date().toISOString().split('T')[0]}.csv`,
          message: `Se han procesado ${clients.length} clientes con éxito. Haz clic abajo para descargar el archivo CSV.`,
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
        const client = await prisma.client.findFirst({
          where: { id: clientId, userId },
          select: { name: true, phone: true },
        });
        if (!client) return { error: "Client not found or access denied." };
        if (!client.phone) return { error: `${client.name} does not have a phone number registered. Add one first.` };

        // Normalize phone: strip spaces, dashes; if not starting with +, add +34 (Spain default)
        const rawPhone = client.phone.replace(/[\s\-()]/g, "");
        const phone = rawPhone.startsWith("+") ? rawPhone.replace("+", "") : `34${rawPhone}`;

        let messageBody = "";

        if (customMessage) {
          messageBody = customMessage;
        } else if (messageType === "payment_reminder") {
          const amountStr = amountDue != null ? `${amountDue} EUR` : "the pending amount";
          const dueDateStr = dueDate ? ` before ${new Date(dueDate).toLocaleDateString("es-ES")}` : "";
          const platformStr = platform ? ` for ${platform}` : "";
          messageBody = `Hello ${client.name}, this is a reminder that your payment of ${amountStr}${platformStr} is pending${dueDateStr}. Please arrange the payment at your earliest convenience.`;
        } else if (messageType === "credentials_update") {
          const platformStr = platform ? ` for ${platform}` : "";
          const userLine = newUsername ? `Username: ${newUsername}` : "";
          const passLine = newPassword ? `Password: ${newPassword}` : "";
          const credLines = [userLine, passLine].filter(Boolean).join("\n");
          messageBody = `Hello ${client.name}, your access credentials${platformStr} have been updated.\n${credLines}\nPlease update these in your device. Contact me if you need help.`;
        } else {
          messageBody = `Hello ${client.name}.`;
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
      description: "Propose an update to the user's personal configuration (e.g. discipline penalty, currency).",
      parameters: z.object({
        disciplinePenalty: z.number().min(0.1).max(2.0).describe("0.5 to 2.0").optional(),
        currency: z.string().length(3).describe("ISO code (e.g. EUR)").optional(),
      }),
      handler: async ({ disciplinePenalty, currency }: any) => {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { disciplinePenalty: true, currency: true }});
        if (!user) return { error: "User not found." };
        const pendingChanges = { ...(disciplinePenalty !== undefined ? { disciplinePenalty } : {}), ...(currency ? { currency } : {}) };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "updateUserConfig", targetId: userId, action: "update", changes: pendingChanges, previousValues: { disciplinePenalty: user.disciplinePenalty, currency: user.currency } });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
        const client = await prisma.client.findFirst({ where: { id: clientId, userId } });
        if (!client) return { error: "Client not found or access denied." };
        const pendingChanges = { name, phone, notes };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "updateClient", targetId: clientId, action: "update", changes: pendingChanges, previousValues: { name: client.name, phone: client.phone, notes: client.notes } });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
        const client = await prisma.client.findFirst({ where: { id: clientId, userId } });
        const sub = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
        if (!client || !sub) return { error: "Client or Subscription not found." };
        const pendingChanges = { clientId, subscriptionId, customPrice, activeUntil, joinedAt, serviceUser, servicePassword };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "assignClientToSubscription", action: "create", changes: pendingChanges, previousValues: null });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
        const cs = await prisma.clientSubscription.findFirst({ where: { id: clientSubscriptionId, subscription: { userId } }, include: { client: true, subscription: { include: { plan: { include: { platform: true } } } } } });
        if (!cs) return { error: "Client subscription not found or access denied." };
        const pendingChanges = { clientSubscriptionId, amountPaid, monthsRenewed, paidOn, notes };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "logPayment", action: "create", changes: pendingChanges, previousValues: { activeUntil: cs.activeUntil.toISOString() } });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
        return { status: "requires_confirmation", __token: token, expiresAt, message: `I'm ready to register a payment of ${amountPaid}€ from ${cs.client.name}.`, pendingChanges };
      },
    }),

    // --- BULK AND POTENTIALLY DESTRUCTIVE TOOLS ---
    defineTool("deleteClients", {
      description: "Propose the COMPLETE and PERMANENT deletion of one or multiple clients. MUST narrate client info before calling.",
      parameters: z.object({
        clientIds: z.array(z.string()).describe("An array of client IDs to delete."),
      }),
      handler: async ({ clientIds }: any) => {
        const clients = await prisma.client.findMany({
          where: { id: { in: clientIds }, userId },
          include: {
            clientSubscriptions: {
              include: {
                renewalLogs: true,
              },
            },
            ownedSubscriptions: {
              select: {
                id: true,
              },
            },
          },
        });
        if (!clients.length) return { error: "Clients not found or access denied." };

        const previousValues = serializeDeletedClients(clients);

        const pendingChanges = { clientIds };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "deleteClients", targetId: "bulk", action: "delete", changes: pendingChanges, previousValues: previousValues as any });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
        return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to permanently delete ${clients.length} client(s): ${clients.map((c: any) => c.name).join(", ")}.`, pendingChanges };
      },
    }),

    defineTool("removeClientsFromSubscription", {
      description: "Propose unassigning one or multiple clients from their seat(s).",
      parameters: z.object({
        clientSubscriptionIds: z.array(z.string()).describe("An array of ClientSubscription pivot record IDs to delete."),
      }),
      handler: async ({ clientSubscriptionIds }: any) => {
        const css = await prisma.clientSubscription.findMany({ where: { id: { in: clientSubscriptionIds }, client: { userId } }, include: { client: true, subscription: true, renewalLogs: true } });
        if (!css.length) return { error: "Client subscriptions not found or access denied." };
        
        const previousValues = css.map(c => ({
            id: c.id, clientId: c.clientId, subscriptionId: c.subscriptionId, customPrice: c.customPrice,
            activeUntil: c.activeUntil.toISOString(), joinedAt: c.joinedAt.toISOString(), leftAt: c.leftAt?.toISOString() ?? null,
            status: c.status, remainingDays: c.remainingDays ?? null, serviceUser: c.serviceUser ?? null, servicePassword: c.servicePassword ?? null,
            renewalLogs: c.renewalLogs.map(rl => ({
                id: rl.id,
                clientSubscriptionId: rl.clientSubscriptionId,
                amountPaid: rl.amountPaid,
                expectedAmount: rl.expectedAmount,
                periodStart: rl.periodStart.toISOString(),
                periodEnd: rl.periodEnd.toISOString(),
                paidOn: rl.paidOn.toISOString(),
                dueOn: rl.dueOn.toISOString(),
                monthsRenewed: rl.monthsRenewed,
                notes: rl.notes ?? null,
                createdAt: rl.createdAt.toISOString(),
            })),
        }));

        const pendingChanges = { clientSubscriptionIds };
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "removeClientsFromSubscription", targetId: "bulk", action: "delete", changes: pendingChanges, previousValues: previousValues as any });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
            const platforms = await prisma.platform.findMany({ where: { id: { in: platformIds }, userId } });
            previousValues = platforms.map(p => ({ id: p.id, name: p.name }));
        } else if (operation === "update" && platformIds && platformIds[0]) {
            const p = await prisma.platform.findFirst({ where: { id: platformIds[0], userId } });
            previousValues = p ? [{ id: p.id, name: p.name }] : [];
        }

        const { token, expiresAt } = await createMutationToken(userId, { toolName: "managePlatforms", action: operation as any, changes: pendingChanges, previousValues });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
            const plans = await prisma.plan.findMany({ where: { id: { in: planIds }, platform: { userId } }});
            previousValues = plans;
        } else if (operation === "update" && planIds && planIds[0]) {
            const p = await prisma.plan.findFirst({ where: { id: planIds[0], platform: { userId } } });
            previousValues = p ? [p] : [];
        }
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "managePlans", action: operation as any, changes: pendingChanges, previousValues });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
            const subs = await prisma.subscription.findMany({
                where: { id: { in: subscriptionIds }, userId },
                include: {
                    clientSubscriptions: {
                        include: { renewalLogs: true },
                    },
                    platformRenewals: true,
                },
            });
            previousValues = subs.map(sub => ({
                id: sub.id,
                userId: sub.userId,
                planId: sub.planId,
                label: sub.label,
                startDate: sub.startDate.toISOString(),
                activeUntil: sub.activeUntil.toISOString(),
                status: sub.status,
                isAutopayable: sub.isAutopayable,
                createdAt: sub.createdAt.toISOString(),
                masterUsername: sub.masterUsername ?? null,
                masterPassword: sub.masterPassword ?? null,
                defaultPaymentNote: sub.defaultPaymentNote ?? null,
                ownerId: sub.ownerId ?? null,
                clientSubscriptions: sub.clientSubscriptions.map(cs => ({
                    id: cs.id,
                    clientId: cs.clientId,
                    subscriptionId: cs.subscriptionId,
                    customPrice: cs.customPrice,
                    activeUntil: cs.activeUntil.toISOString(),
                    joinedAt: cs.joinedAt.toISOString(),
                    leftAt: cs.leftAt?.toISOString() ?? null,
                    status: cs.status,
                    remainingDays: cs.remainingDays ?? null,
                    serviceUser: cs.serviceUser ?? null,
                    servicePassword: cs.servicePassword ?? null,
                    renewalLogs: cs.renewalLogs.map(rl => ({
                        id: rl.id,
                        clientSubscriptionId: rl.clientSubscriptionId,
                        amountPaid: rl.amountPaid,
                        expectedAmount: rl.expectedAmount,
                        periodStart: rl.periodStart.toISOString(),
                        periodEnd: rl.periodEnd.toISOString(),
                        paidOn: rl.paidOn.toISOString(),
                        dueOn: rl.dueOn.toISOString(),
                        monthsRenewed: rl.monthsRenewed,
                        notes: rl.notes ?? null,
                        createdAt: rl.createdAt.toISOString(),
                    })),
                })),
                platformRenewals: sub.platformRenewals.map(pr => ({
                    id: pr.id,
                    subscriptionId: pr.subscriptionId,
                    amountPaid: pr.amountPaid,
                    periodStart: pr.periodStart.toISOString(),
                    periodEnd: pr.periodEnd.toISOString(),
                    paidOn: pr.paidOn.toISOString(),
                    notes: pr.notes ?? null,
                    createdAt: pr.createdAt.toISOString(),
                })),
            }));
        } else if (operation === "update" && subscriptionIds && subscriptionIds[0]) {
            const p = await prisma.subscription.findFirst({ where: { id: subscriptionIds[0], userId } });
            previousValues = p ? [p] : [];
        }
        const { token, expiresAt } = await createMutationToken(userId, { toolName: "manageSubscriptions", action: operation as any, changes: pendingChanges, previousValues });
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });
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
        const payment = await prisma.renewalLog.findFirst({
          where: { id: paymentId, clientSubscription: { subscription: { userId } } },
          include: {
            clientSubscription: {
              include: {
                client: { select: { name: true } },
                subscription: { select: { label: true, plan: { select: { platform: { select: { name: true } } } } } },
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
          paidOn: payment.paidOn.toISOString(),
          periodStart: payment.periodStart.toISOString(),
          periodEnd: payment.periodEnd.toISOString(),
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
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });

        if (operation === "delete") {
          return {
            status: "requires_confirmation",
            __token: token,
            expiresAt,
            message: `I am ready to **permanently delete** the payment of €${Number(payment.amountPaid).toFixed(2)} from **${clientName}** (${platform}) paid on ${payment.paidOn.toISOString().split("T")[0]}.`,
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
        const seats = await prisma.clientSubscription.findMany({
          where: { id: { in: clientSubscriptionIds }, client: { userId } },
          include: { client: { select: { name: true } }, subscription: { select: { label: true } } },
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
        await prisma.mutationAuditLog.update({ where: { token }, data: { newValues: pendingChanges } });

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
