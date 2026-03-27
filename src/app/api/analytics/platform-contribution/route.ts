import { eq, and, gte, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { platforms, plans, subscriptions, clientSubscriptions, renewalLogs, platformRenewals } from "@/db/schema";
import { success, withErrorHandling } from "@/lib/api-utils";
import { startOfMonth, subMonths } from "date-fns";

// GET /api/analytics/platform-contribution — Platform contribution over the last 12 months (monthly window)
export async function GET() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const fromDate = startOfMonth(subMonths(new Date(), 11));
    const fromDateStr = fromDate.toISOString().split("T")[0];

    const [platformsList, revenueResult, costResult] = await Promise.all([
      db.query.platforms.findMany({
        where: eq(platforms.userId, userId),
        columns: { id: true, name: true },
        orderBy: [asc(platforms.name)],
      }),
      db
        .select({
          platformId: platforms.id,
          platform: platforms.name,
          revenue: sql<number>`COALESCE(SUM(${renewalLogs.amountPaid}), 0)`,
        })
        .from(platforms)
        .leftJoin(plans, eq(plans.platformId, platforms.id))
        .leftJoin(subscriptions, eq(subscriptions.planId, plans.id))
        .leftJoin(clientSubscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
        .leftJoin(
          renewalLogs,
          and(
            eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id),
            gte(renewalLogs.paidOn, fromDateStr)
          )
        )
        .where(eq(platforms.userId, userId))
        .groupBy(platforms.id, platforms.name),
      db
        .select({
          platformId: platforms.id,
          cost: sql<number>`COALESCE(SUM(${platformRenewals.amountPaid}), 0)`,
        })
        .from(platforms)
        .leftJoin(plans, eq(plans.platformId, platforms.id))
        .leftJoin(subscriptions, eq(subscriptions.planId, plans.id))
        .leftJoin(
          platformRenewals,
          and(
            eq(platformRenewals.subscriptionId, subscriptions.id),
            gte(platformRenewals.paidOn, fromDateStr)
          )
        )
        .where(eq(platforms.userId, userId))
        .groupBy(platforms.id),
    ]);

    const revenueRows = revenueResult || [];
    const costRows = costResult || [];

    const revenueMap = new Map<string, number>(
      revenueRows.map((r: any) => [r.platformId, Number(r.revenue || 0)])
    );
    const costMap = new Map<string, number>(
      costRows.map((c: any) => [c.platformId, Number(c.cost || 0)])
    );

    const rows = platformsList.map((platform: any) => {
      const revenue = revenueMap.get(platform.id) ?? 0;
      const cost = costMap.get(platform.id) ?? 0;
      const net = revenue - cost;

      return {
        platformId: platform.id,
        platform: platform.name,
        revenue,
        cost,
        net,
      };
    });

    rows.sort((a: any, b: any) => Math.abs(b.net) - Math.abs(a.net));

    return success({
      from: fromDate,
      to: new Date(),
      rows,
    });
  });
}
