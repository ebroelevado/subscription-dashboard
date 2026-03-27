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

    // Build overdue + expiring-soon lists
    const overdueSeats = allActiveSeats
      .filter((s) => new Date(s.activeUntil) < today)
      .map((s) => ({
        id: s.id,
        clientId: s.client.id,
        clientName: s.client.name,
        clientPhone: s.client.phone,
        customPrice: Number(s.customPrice),
        activeUntil: s.activeUntil,
        daysOverdue: Math.floor(
          (today.getTime() - new Date(s.activeUntil).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
        platform: s.subscription.plan.platform.name,
        plan: s.subscription.plan.name,
        subscriptionLabel: s.subscription.label,
        subscriptionId: s.subscription.id,
      }));

    const expiringSoonSeats = allActiveSeats
      .filter(
        (s) =>
          new Date(s.activeUntil) >= today &&
          new Date(s.activeUntil) <= soonThreshold,
      )
      .map((s) => ({
        id: s.id,
        clientId: s.client.id,
        clientName: s.client.name,
        clientPhone: s.client.phone,
        customPrice: Number(s.customPrice),
        activeUntil: s.activeUntil,
        daysLeft: Math.ceil(
          (new Date(s.activeUntil).getTime() - today.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
        platform: s.subscription.plan.platform.name,
        subscriptionLabel: s.subscription.label,
        subscriptionId: s.subscription.id,
      }));

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
      overdueSeats,
      expiringSoonSeats,
    });
  });
}
