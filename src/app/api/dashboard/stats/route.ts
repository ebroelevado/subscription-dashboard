import { db } from "@/db";
import { eq, sql, desc, and, gte, lte, sum } from "drizzle-orm";
import { platforms, plans, clients, subscriptions, clientSubscriptions, renewalLogs, platformRenewals } from "@/db/schema";
import { success, withErrorHandling } from "@/lib/api-utils";
import { startOfDay, addDays, startOfMonth, endOfMonth } from "date-fns";

// GET /api/dashboard/stats — Aggregated overview scoped to current user
export async function GET() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const today = startOfDay(new Date());
    const soonThreshold = addDays(today, 3);
    const monthStart = startOfMonth(today).toISOString().split("T")[0];
    const monthEnd = endOfMonth(today).toISOString().split("T")[0];

    // Run all counts in parallel — use aggregates where possible
    const [
      platformCount,
      activePlanCount,
      clientCount,
      activeSubscriptionCount,
      monthlyCostAgg,
      allActiveSeats,
      thisMonthRevenueAgg,
      thisMonthCostAgg,
    ] = await Promise.all([
      db.$count(platforms, eq(platforms.userId, userId)),
      db.$count(plans, eq(plans.userId, userId)),
      db.$count(clients, eq(clients.userId, userId)),
      // Count only — no need to load full rows
      db.$count(subscriptions, eq(subscriptions.userId, userId)),
      // SUM plan.cost for active subscriptions (replaces findMany + reduce)
      db.select({
        total: sql<string>`COALESCE(SUM(${plans.cost}), 0)`,
      })
        .from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        )),
      // Active seats — still need full rows for overdue/expiring display
      db.query.clientSubscriptions.findMany({
        where: eq(clientSubscriptions.status, "active"),
        with: {
          client: {
            columns: { id: true, name: true, phone: true },
          },
          subscription: {
            columns: { id: true, label: true, userId: true },
            with: {
              plan: {
                columns: { id: true, name: true },
                with: {
                  platform: { columns: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: [desc(clientSubscriptions.activeUntil)],
      }),
      // This month revenue — aggregate instead of findMany + reduce
      db.select({
        total: sql<string>`COALESCE(SUM(${renewalLogs.amountPaid}), 0)`,
      })
        .from(renewalLogs)
        .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
        .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
        .where(and(
          eq(subscriptions.userId, userId),
          gte(renewalLogs.paidOn, monthStart),
          lte(renewalLogs.paidOn, monthEnd)
        )),
      // This month cost — aggregate instead of findMany + reduce
      db.select({
        total: sql<string>`COALESCE(SUM(${platformRenewals.amountPaid}), 0)`,
      })
        .from(platformRenewals)
        .innerJoin(subscriptions, eq(platformRenewals.subscriptionId, subscriptions.id))
        .where(and(
          eq(subscriptions.userId, userId),
          gte(platformRenewals.paidOn, monthStart),
          lte(platformRenewals.paidOn, monthEnd)
        )),
    ]);

    // Financials from aggregates (no more in-memory reduce)
    const monthlyCost = Number(monthlyCostAgg[0]?.total ?? 0);
    const monthlyRevenue = allActiveSeats.reduce(
      (sum, s) => sum + Number(s.customPrice),
      0,
    );
    const thisMonthRevenue = Number(thisMonthRevenueAgg[0]?.total ?? 0);
    const thisMonthCost = Number(thisMonthCostAgg[0]?.total ?? 0);

    // Build client summaries and grouped lists
    const clientMap = new Map<string, {
      clientId: string;
      clientName: string;
      clientPhone: string | null;
      overdueCount: number;
      expiringCount: number;
      okayCount: number;
      totalCount: number;
      maxDaysOverdue: number;
      minDaysLeft: number;
    }>();

    allActiveSeats.forEach((s) => {
      const activeUntilDate = new Date(s.activeUntil);
      let status: "overdue" | "expiring" | "okay" = "okay";
      let daysOverdue = 0;
      let daysLeft = 0;

      if (activeUntilDate < today) {
        status = "overdue";
        daysOverdue = Math.floor(
          (today.getTime() - activeUntilDate.getTime()) / (1000 * 60 * 60 * 24),
        );
      } else if (activeUntilDate <= soonThreshold) {
        status = "expiring";
        daysLeft = Math.ceil(
          (activeUntilDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
      }

      if (!clientMap.has(s.client.id)) {
        clientMap.set(s.client.id, {
          clientId: s.client.id,
          clientName: s.client.name,
          clientPhone: s.client.phone,
          overdueCount: 0,
          expiringCount: 0,
          okayCount: 0,
          totalCount: 0,
          maxDaysOverdue: 0,
          minDaysLeft: 9999,
        });
      }

      const client = clientMap.get(s.client.id)!;
      client.totalCount++;
      if (status === "overdue") {
        client.overdueCount++;
        client.maxDaysOverdue = Math.max(client.maxDaysOverdue, daysOverdue);
      } else if (status === "expiring") {
        client.expiringCount++;
        client.minDaysLeft = Math.min(client.minDaysLeft, daysLeft);
      } else {
        client.okayCount++;
      }
    });

    // Finalize groups
    const overdueGroups = Array.from(clientMap.values())
      .filter((c) => c.overdueCount > 0)
      .sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue);

    const expiringSoonGroups = Array.from(clientMap.values())
      .filter((c) => c.overdueCount === 0 && c.expiringCount > 0)
      .sort((a, b) => a.minDaysLeft - b.minDaysLeft);

    return success({
      platformCount,
      activePlanCount,
      clientCount,
      activeSubscriptionCount,
      activeSeatCount: allActiveSeats.length,
      monthlyCost,
      monthlyRevenue,
      profit: monthlyRevenue - monthlyCost,
      thisMonthRevenue,
      thisMonthCost,
      thisMonthProfit: thisMonthRevenue - thisMonthCost,
      overdueGroups,
      expiringSoonGroups,
    });
  });
}
