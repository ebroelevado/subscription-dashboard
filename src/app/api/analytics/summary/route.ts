import { eq, and, sql, between } from "drizzle-orm";
import { db } from "@/db";
import { renewalLogs, clientSubscriptions, subscriptions, platformRenewals } from "@/db/schema";
import { success, withErrorHandling } from "@/lib/api-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";

// GET /api/analytics/summary — Core KPIs scoped to the current user
export async function GET() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const now = new Date();
    const startOfCurrentMonthStr = format(startOfMonth(now), "yyyy-MM-dd");
    const endOfCurrentMonthStr = format(endOfMonth(now), "yyyy-MM-dd");

    const [
      revenueAgg, 
      costAgg, 
      uniqueClients, 
      totalPayments, 
      onTimeCount,
      monthlyRevenueAgg,
      monthlyCostAgg,
      monthlyUniqueClients
    ] = await Promise.all([
        db
          .select({ total: sql<string>`COALESCE(SUM(${renewalLogs.amountPaid}), 0)` })
          .from(renewalLogs)
          .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .where(eq(subscriptions.userId, userId)),
        db
          .select({ total: sql<string>`COALESCE(SUM(${platformRenewals.amountPaid}), 0)` })
          .from(platformRenewals)
          .innerJoin(subscriptions, eq(platformRenewals.subscriptionId, subscriptions.id))
          .where(eq(subscriptions.userId, userId)),
        db
          .selectDistinct({ clientId: clientSubscriptions.clientId })
          .from(clientSubscriptions)
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .innerJoin(renewalLogs, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .where(eq(subscriptions.userId, userId)),
        db
          .select({ total: sql<number>`COUNT(*)` })
          .from(renewalLogs)
          .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .where(eq(subscriptions.userId, userId)),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(renewalLogs)
          .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .where(
            and(
              eq(subscriptions.userId, userId),
              sql`${renewalLogs.paidOn} <= ${renewalLogs.dueOn}`
            )
          ),
        db
          .select({ total: sql<string>`COALESCE(SUM(${renewalLogs.amountPaid}), 0)` })
          .from(renewalLogs)
          .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .where(
            and(
              eq(subscriptions.userId, userId),
              between(renewalLogs.paidOn, startOfCurrentMonthStr, endOfCurrentMonthStr)
            )
          ),
        db
          .select({ total: sql<string>`COALESCE(SUM(${platformRenewals.amountPaid}), 0)` })
          .from(platformRenewals)
          .innerJoin(subscriptions, eq(platformRenewals.subscriptionId, subscriptions.id))
          .where(
            and(
              eq(subscriptions.userId, userId),
              between(platformRenewals.paidOn, startOfCurrentMonthStr, endOfCurrentMonthStr)
            )
          ),
        db
          .selectDistinct({ clientId: clientSubscriptions.clientId })
          .from(clientSubscriptions)
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .innerJoin(renewalLogs, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .where(
            and(
              eq(subscriptions.userId, userId),
              between(renewalLogs.paidOn, startOfCurrentMonthStr, endOfCurrentMonthStr)
            )
          ),
      ]);

    const totalRevenue = Number(revenueAgg[0]?.total ?? 0);
    const totalCost = Number(costAgg[0]?.total ?? 0);
    const netMargin = totalRevenue - totalCost;
    const uniqueClientCount = uniqueClients.length;
    const arpu = uniqueClientCount > 0 ? totalRevenue / uniqueClientCount : 0;
    const totalPaymentsNum = Number(totalPayments[0]?.total ?? 0);

    const onTimeCountNum = Number(onTimeCount[0]?.count ?? 0);
    const onTimeRate =
      totalPaymentsNum > 0 ? (onTimeCountNum / totalPaymentsNum) * 100 : 100;

    const monthlyRevenue = Number(monthlyRevenueAgg[0]?.total ?? 0);
    const monthlyCost = Number(monthlyCostAgg[0]?.total ?? 0);
    const monthlyNetMargin = monthlyRevenue - monthlyCost;
    const monthlyUniqueClientCount = monthlyUniqueClients.length;
    const monthlyArpu = monthlyUniqueClientCount > 0 ? monthlyRevenue / monthlyUniqueClientCount : 0;

    return success({
      totalRevenue,
      totalCost,
      netMargin,
      arpu,
      onTimeRate,
      totalPayments: totalPaymentsNum,
      onTimeCount: onTimeCountNum,
      lateCount: totalPaymentsNum - onTimeCountNum,
      uniqueClientCount,
      monthlyRevenue,
      monthlyCost,
      monthlyNetMargin,
      monthlyArpu,
      monthlyUniqueClientCount
    });
  });
}
