/**
 * Copilot AI Assistant — Read-Only Database Query Tools
 *
 * All tools are scoped to the authenticated user's data (userId).
 * Only read operations (findMany, findUnique, count, aggregate) are used.
 * No raw SQL, no mutations, no cross-tenant data access.
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Type for defineTool — imported dynamically in route.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DefineToolFn = (...args: any[]) => any;

/**
 * Creates all read-only database tools scoped to a specific user.
 */
export function createUserScopedTools(
  defineTool: DefineToolFn,
  userId: string,
) {
  return [
    // ──────────────────────────────────────────
    // 1. listClients — Search/list clients
    // ──────────────────────────────────────────
    defineTool("listClients", {
      description:
        "List or search the user's clients. Returns name, phone, notes, and number of active subscriptions. Use this to find clients or get an overview.",
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
                  ],
                }
              : {}),
          },
          include: {
            _count: { select: { clientSubscriptions: true } },
          },
          orderBy: { name: "asc" },
          take: Math.min(limit, 50),
        });

        return {
          totalFound: clients.length,
          clients: clients.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            notes: c.notes,
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
        "Get full details for a specific client including all their active subscriptions (seats), which platforms they're on, what they pay, and their recent payment history.",
      parameters: z.object({
        clientId: z.string().describe("The client's ID"),
      }),
      handler: async ({ clientId }: { clientId: string }) => {
        const client = await prisma.client.findFirst({
          where: { id: clientId, userId },
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
                  take: 5,
                },
              },
            },
            ownedSubscriptions: {
              select: { id: true, label: true },
            },
          },
        });

        if (!client) return { error: "Client not found or access denied" };

        return {
          id: client.id,
          name: client.name,
          phone: client.phone,
          notes: client.notes,
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
        };
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
        "Get full details of a specific subscription including all assigned client seats, credentials, and recent platform renewals.",
      parameters: z.object({
        subscriptionId: z.string().describe("The subscription ID"),
      }),
      handler: async ({ subscriptionId }: { subscriptionId: string }) => {
        const sub = await prisma.subscription.findFirst({
          where: { id: subscriptionId, userId },
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

        if (!sub) return { error: "Subscription not found or access denied" };

        return {
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
        };
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
        const [
          activeSeats,
          totalClients,
          platforms,
          subscriptions,
        ] = await Promise.all([
          prisma.clientSubscription.findMany({
            where: {
              status: "active",
              subscription: { userId },
            },
            select: { customPrice: true },
          }),
          prisma.client.count({ where: { userId } }),
          prisma.platform.findMany({
            where: { userId },
            include: {
              plans: {
                include: {
                  subscriptions: {
                    where: { status: "active" },
                    include: {
                      clientSubscriptions: {
                        where: { status: "active" },
                        select: { customPrice: true },
                      },
                    },
                  },
                },
              },
            },
          }),
          prisma.subscription.findMany({
            where: { userId, status: "active" },
            select: { plan: { select: { cost: true } } },
          }),
        ]);

        const totalMRR = activeSeats.reduce(
          (sum, s) => sum + Number(s.customPrice),
          0,
        );
        const totalCosts = subscriptions.reduce(
          (sum, s) => sum + Number(s.plan.cost),
          0,
        );

        const perPlatform = platforms.map((p) => {
          const revenue = p.plans.flatMap((pl) =>
            pl.subscriptions.flatMap((s) =>
              s.clientSubscriptions.map((cs) => Number(cs.customPrice)),
            ),
          );
          const costs = p.plans.flatMap((pl) =>
            pl.subscriptions.map((_) => Number(pl.cost)),
          );
          return {
            platform: p.name,
            revenue: revenue.reduce((a, b) => a + b, 0),
            costs: costs.reduce((a, b) => a + b, 0),
            activeSeats: revenue.length,
            activeSubscriptions: p.plans.flatMap((pl) => pl.subscriptions)
              .length,
          };
        });

        return {
          totalMRR,
          totalCosts,
          netProfit: totalMRR - totalCosts,
          profitMargin:
            totalMRR > 0
              ? `${((1 - totalCosts / totalMRR) * 100).toFixed(1)}%`
              : "N/A",
          totalClients,
          totalActiveSeats: activeSeats.length,
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
  ];
}
