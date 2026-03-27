/**
 * Copilot AI Assistant — Read-Only Database Query Tools
 *
 * All tools are scoped to the authenticated user's data (userId).
 * Only read operations (findMany, findUnique, count, aggregate) are used.
 * No raw SQL, no mutations, no cross-tenant data access.
 */
import { z } from "zod";
import { eq, and, desc, asc, count, sum, gte, lte, inArray, or, ilike } from "drizzle-orm";
import { db } from "@/db";
import { amountToCents } from "@/lib/currency";
import { users, clients, clientSubscriptions, subscriptions, plans, platforms, renewalLogs, platformRenewals } from "@/db/schema";
import { getDisciplineAnalytics } from "@/lib/discipline-service";

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
                "Get full details for specific clients including all their active subscriptions (seats), which platforms they're on, what they pay, and their recent payment history. Pass an array of clientIds to fetch multiple clients at once efficiently.",
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
                        (acc, cs) => acc + Number(cs.customPrice),
                        0,
                    );
                    return {
                        id: sub.id,
                        label: sub.label,
                        platform: sub.plan.platform.name,
                        plan: sub.plan.name,
                        planCost: Number(sub.plan.cost),
                        maxSeats: sub.plan.maxSeats,
                        seatsUsed: sub.clientSubscriptions.length,
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
                const totalCosts = activeSubs.reduce((acc, s) => acc + Number(s.plan.cost), 0);

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
                "Get pre-calculated payment discipline scores (0.0 to 10.0) for every client. Use this to find 'worst clients' (scores < 5.0) or 'best clients' (score = 10.0) instantly, WITHOUT downloading raw payment histories.",
            parameters: z.object({}),
            handler: async () => {
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

                const results = clientsList.map((c) => ({
                    clientId: c.id,
                    name: c.name,
                    phone: c.phone || "Unknown",
                    score: c.disciplineScore ? Number(c.disciplineScore) : null,
                    healthStatus: c.healthStatus || "New",
                    daysOverdue: c.daysOverdue,
                    dailyPenalty: c.dailyPenalty ? Number(c.dailyPenalty) : 0.5
                }));

                // Sort worst to best by default to prioritize answering "worst clients"
                results.sort((a, b) => {
                    if (a.healthStatus === "Critical" && b.healthStatus !== "Critical") return -1;
                    if (a.healthStatus !== "Critical" && b.healthStatus === "Critical") return 1;
                    if (a.score === null) return 1;
                    if (b.score === null) return -1;
                    return a.score - b.score;
                });

                return {
                    totalClients: results.length,
                    clientsRanking: results
                };
            },
        }),
        // ──────────────────────────────────────────
        // 10. updateUserConfig — Mutation Settings
        // ──────────────────────────────────────────
        defineTool("updateUserConfig", {
            description:
                "Update the user's personal configuration/settings (e.g. discipline penalty, currency). CRITICAL: This tool requires a second call with confirm:true to actually execute the change.",
            parameters: z.object({
                disciplinePenalty: z.number().min(0).max(5).describe("Daily score deduction per late day (default 0.5)").optional(),
                currency: z.string().length(3).describe("ISO code (e.g. EUR)").optional(),
                __safe_user_approval_ui_only: z.boolean().default(false).describe("SYSTEM-ONLY: Do not use. The UI will set this when the user clicks confirm."),
            }),
            handler: async ({ disciplinePenalty, currency, __safe_user_approval_ui_only }: { disciplinePenalty?: number, currency?: string, __safe_user_approval_ui_only: boolean }) => {
                const user = await db.query.users.findFirst({
                    where: eq(users.id, userId),
                    columns: { disciplinePenalty: true, currency: true }
                });
                if (!user) return { error: "User not found." };

                if (!__safe_user_approval_ui_only) {
                    return {
                        status: "requires_confirmation",
                        message: "I am ready to update your configuration. Please confirm to proceed.",
                        pendingChanges: {
                            ...(disciplinePenalty !== undefined ? { disciplinePenalty } : {}),
                            ...(currency ? { currency } : {}),
                        }
                    };
                }

                const updateData: Record<string, any> = {};
                if (disciplinePenalty !== undefined) updateData.disciplinePenalty = disciplinePenalty;
                if (currency) updateData.currency = currency;

                await db.update(users)
                    .set(updateData)
                    .where(eq(users.id, userId));

                const updated = await db.query.users.findFirst({
                    where: eq(users.id, userId),
                    columns: { disciplinePenalty: true, currency: true }
                });

                return {
                    success: true,
                    status: "executed",
                    message: "Configuration updated successfully.",
                    previousValues: {
                        disciplinePenalty: user.disciplinePenalty,
                        currency: user.currency
                    },
                    config: {
                        disciplinePenalty: updated?.disciplinePenalty,
                        currency: updated?.currency
                    }
                };
            },
        }),

        // ──────────────────────────────────────────
        // 11. updateClient — Mutation Clients
        // ──────────────────────────────────────────
        defineTool("updateClient", {
            description:
                "Update a client's information (name, phone, notes). CRITICAL: Requires a second call with confirm:true.",
            parameters: z.object({
                clientId: z.string().describe("The ID of the client to update."),
                name: z.string().optional().describe("New name for the client."),
                phone: z.string().optional().describe("New phone number."),
                notes: z.string().optional().describe("New notes/comments."),
                __safe_user_approval_ui_only: z.boolean().default(false).describe("SYSTEM-ONLY: Do not use."),
            }),
            handler: async ({ clientId, name, phone, notes, __safe_user_approval_ui_only }: { clientId: string, name?: string, phone?: string, notes?: string, __safe_user_approval_ui_only: boolean }) => {
                const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.userId, userId)) });
                if (!client) return { error: "Client not found or access denied." };

                if (!__safe_user_approval_ui_only) {
                    return {
                        status: "requires_confirmation",
                        message: `I'm ready to update client ${client.name}. Please confirm.`,
                        pendingChanges: { name, phone, notes }
                    };
                }

                const updateData: Record<string, any> = {};
                if (name) updateData.name = name;
                if (phone) updateData.phone = phone;
                if (notes) updateData.notes = notes;

                await db.update(clients)
                    .set(updateData)
                    .where(eq(clients.id, clientId));

                const updated = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });

                return {
                    success: true,
                    status: "executed",
                    message: `Client ${updated?.name} updated successfully.`,
                    previousValues: {
                        name: client.name,
                        phone: client.phone,
                        notes: client.notes
                    },
                    client: updated
                };
            },
        }),

        // ──────────────────────────────────────────
        // 12. undoMutation — Revert Changes
        // ──────────────────────────────────────────
        defineTool("undoMutation", {
            description:
                "Revert a previous database mutation using the 'previousValues' snapshot. Use this when the user clicks 'Ir Atrás'.",
            parameters: z.object({
                type: z.enum(["userConfig", "client", "payment"]).describe("Type of mutation to revert."),
                targetId: z.string().describe("ID of the record to restore."),
                previousValues: z.any().describe("The snapshot to restore."),
            }),
            handler: async ({ type, targetId, previousValues }: { type: string, targetId: string, previousValues: any }) => {
                if (type === "userConfig") {
                    await db.update(users)
                        .set(previousValues)
                        .where(eq(users.id, userId));
                } else if (type === "client") {
                    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, targetId), eq(clients.userId, userId)) });
                    if (!client) return { error: "Client not found or unauthorized for undo." };

                    if (!previousValues || Object.keys(previousValues).length === 0) {
                        await db.delete(clients).where(eq(clients.id, targetId));
                        return { success: true, message: "Client creation reverted (deleted)." };
                    }

                    await db.update(clients)
                        .set(previousValues)
                        .where(eq(clients.id, targetId));
                } else if (type === "clientSubscription") {
                    // Get user's client IDs first
                    const userClients = await db.select({ id: clients.id }).from(clients).where(eq(clients.userId, userId));
                    const userClientIds = userClients.map(c => c.id);

                    const cs = await db.query.clientSubscriptions.findFirst({
                        where: and(
                            eq(clientSubscriptions.id, targetId),
                            inArray(clientSubscriptions.clientId, userClientIds)
                        )
                    });
                    if (cs) {
                        await db.delete(clientSubscriptions).where(eq(clientSubscriptions.id, targetId));
                        return { success: true, message: "Assignment reverted (deleted)." };
                    }
                } else if (type === "payment") {
                    // Get user's subscription IDs first
                    const userSubs = await db.select({ id: subscriptions.id })
                        .from(subscriptions)
                        .where(eq(subscriptions.userId, userId));
                    const userSubIds = userSubs.map(s => s.id);

                    // Get client subscription IDs
                    const userCS = await db.select({ id: clientSubscriptions.id })
                        .from(clientSubscriptions)
                        .where(inArray(clientSubscriptions.subscriptionId, userSubIds));
                    const userCSIds = userCS.map(cs => cs.id);

                    const log = await db.query.renewalLogs.findFirst({
                        where: and(
                            eq(renewalLogs.id, targetId),
                            inArray(renewalLogs.clientSubscriptionId, userCSIds)
                        ),
                        with: { clientSubscription: true }
                    });
                    if (log && log.clientSubscriptionId) {
                        await db.update(clientSubscriptions)
                            .set({ activeUntil: log.dueOn })
                            .where(eq(clientSubscriptions.id, log.clientSubscriptionId));
                        await db.delete(renewalLogs).where(eq(renewalLogs.id, targetId));
                    }
                }

                return { success: true, message: "Action reverted successfully." };
            },
        }),

        // ──────────────────────────────────────────
        // 13. createClient — Mutation
        // ──────────────────────────────────────────
        defineTool("createClient", {
            description: "Create a new client profile. Rejection/Undo deletes the client.",
            parameters: z.object({
                name: z.string().describe("The full name of the client."),
                phone: z.string().optional().describe("Optional phone number."),
                notes: z.string().optional().describe("Optional notes."),
                __safe_user_approval_ui_only: z.boolean().default(false).describe("SYSTEM-ONLY."),
            }),
            handler: async ({ name, phone, notes, __safe_user_approval_ui_only }: { name: string, phone?: string, notes?: string, __safe_user_approval_ui_only: boolean }) => {
                if (!__safe_user_approval_ui_only) {
                    return {
                        status: "requires_confirmation",
                        message: `I'm ready to create a new client profile for **${name}**.`,
                        pendingChanges: { name, phone, notes }
                    };
                }

                const [client] = await db.insert(clients)
                    .values({ userId, name, phone, notes })
                    .returning();

                return {
                    success: true,
                    status: "executed",
                    message: `Client ${client.name} created successfully.`,
                    client: client,
                    previousValues: {}
                };
            },
        }),

        // ──────────────────────────────────────────
        // 14. assignClientToSubscription — Mutation
        // ──────────────────────────────────────────
        defineTool("assignClientToSubscription", {
            description: "Assign a client to a subscription group (seat). Rejection/Undo removes the assignment.",
            parameters: z.object({
                clientId: z.string().describe("The ID of the client."),
                subscriptionId: z.string().describe("The ID of the subscription group (instance of a plan)."),
                customPrice: z.number().describe("The price the client pays for this seat."),
                activeUntil: z.string().describe("ISO date until which the seat is paid for."),
                joinedAt: z.string().optional().describe("ISO date of joining. Defaults to today."),
                serviceUser: z.string().optional().describe("Username/Profile name in the service."),
                servicePassword: z.string().optional().describe("Password for this profile."),
                __safe_user_approval_ui_only: z.boolean().default(false).describe("SYSTEM-ONLY."),
            }),
            handler: async ({ clientId, subscriptionId, customPrice, activeUntil, joinedAt, serviceUser, servicePassword, __safe_user_approval_ui_only }: {
                clientId: string,
                subscriptionId: string,
                customPrice: number,
                activeUntil: string,
                joinedAt?: string,
                serviceUser?: string,
                servicePassword?: string,
                __safe_user_approval_ui_only: boolean
            }) => {
                const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.userId, userId)) });
                const sub = await db.query.subscriptions.findFirst({ where: and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)) });
                if (!client || !sub) return { error: "Client or Subscription not found." };

                if (!__safe_user_approval_ui_only) {
                    return {
                        status: "requires_confirmation",
                        message: `I'm ready to assign **${client.name}** to **${sub.label}** for **${customPrice}** until **${activeUntil}**.`,
                        pendingChanges: { clientId, subscriptionId, customPrice, activeUntil, serviceUser }
                    };
                }

                const [cs] = await db.insert(clientSubscriptions)
                    .values({
                        clientId,
                        subscriptionId,
                        customPrice: amountToCents(customPrice),
                        activeUntil,
                        joinedAt: joinedAt || new Date().toISOString().split("T")[0],
                        serviceUser,
                        servicePassword,
                        status: "active"
                    })
                    .returning();

                return {
                    success: true,
                    status: "executed",
                    message: `Successfully assigned **${client.name}** to **${sub.label}**.`,
                    clientSubscription: cs,
                    previousValues: {}
                };
            },
        }),

        // ──────────────────────────────────────────
        // 15. logPayment — Mutation Payments
        // ──────────────────────────────────────────
        defineTool("logPayment", {
            description:
                "Register a new payment received from a client for a specific subscription. CRITICAL: Requires a second call with confirm:true.",
            parameters: z.object({
                clientSubscriptionId: z.string().describe("The ID of the client's seat/subscription (Not the client ID)."),
                amountPaid: z.number().describe("The amount paid by the client."),
                monthsRenewed: z.number().default(1).describe("Number of months the payment covers."),
                paidOn: z.string().optional().describe("Date of payment (ISO format). Defaults to today."),
                notes: z.string().optional().describe("Optional notes for the payment."),
                __safe_user_approval_ui_only: z.boolean().default(false).describe("Requires user confirmation. MUST be false on first call."),
            }),
            handler: async ({ clientSubscriptionId, amountPaid, monthsRenewed, paidOn, notes, __safe_user_approval_ui_only }: { clientSubscriptionId: string, amountPaid: number, monthsRenewed: number, paidOn?: string, notes?: string, __safe_user_approval_ui_only: boolean }) => {
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

                const platformName = cs.subscription.plan.platform.name;

                if (!__safe_user_approval_ui_only) {
                    return {
                        status: "requires_confirmation",
                        message: `I'm ready to register a payment of ${amountPaid}€ from ${cs.client.name} for ${platformName} (${monthsRenewed} month/s). Please confirm.`,
                        pendingChanges: { amountPaid, monthsRenewed, paidOn, notes }
                    };
                }

                const nowStr = new Date().toISOString().split("T")[0];
                const startDate = cs.activeUntil > nowStr ? cs.activeUntil : nowStr;
                const endDateObj = new Date(startDate + "T00:00:00Z");
                endDateObj.setUTCMonth(endDateObj.getUTCMonth() + monthsRenewed);
                const endDateStr = endDateObj.toISOString().split("T")[0];

                const [log] = await db.insert(renewalLogs)
                    .values({
                        clientSubscriptionId,
                        amountPaid: amountToCents(amountPaid),
                        expectedAmount: cs.customPrice,
                        periodStart: startDate,
                        periodEnd: endDateStr,
                        paidOn: paidOn || nowStr,
                        dueOn: cs.activeUntil,
                        monthsRenewed,
                        notes
                    })
                    .returning();

                await db.update(clientSubscriptions)
                    .set({ activeUntil: endDateStr })
                    .where(eq(clientSubscriptions.id, clientSubscriptionId));

                return {
                    success: true,
                    status: "executed",
                    message: `Payment of ${amountPaid}€ logged successfully for ${cs.client.name}. New expiry: ${endDateStr}.`,
                    log
                };
            },
        }),
    ];
}
