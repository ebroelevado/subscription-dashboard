import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { renewalLogs, clientSubscriptions, subscriptions } from "@/db/schema";
import { success, withErrorHandling } from "@/lib/api-utils";

// GET /api/analytics/clients — Client LTV ranking + revenue weight
export async function GET() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    // Get aggregated revenue per clientSubscriptionId
    const grouped = await db
      .select({
        clientSubscriptionId: renewalLogs.clientSubscriptionId,
        totalPaid: sql<string>`COALESCE(SUM(${renewalLogs.amountPaid}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(renewalLogs)
      .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
      .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.userId, userId))
      .groupBy(renewalLogs.clientSubscriptionId);

    // Fetch client names for the grouped results
    const csIds = grouped
      .map((g) => g.clientSubscriptionId)
      .filter((id): id is string => id !== null);

    const seats = csIds.length > 0
      ? await db.query.clientSubscriptions.findMany({
          where: inArray(clientSubscriptions.id, csIds),
          columns: { id: true, clientId: true },
          with: { client: { columns: { name: true } } },
        })
      : [];

    const seatMap = new Map(seats.map((s) => [s.id, s]));

    // Aggregate by client (a client can have multiple seats)
    const clientMap = new Map<
      string,
      { clientId: string; clientName: string; totalPaid: number; renewalCount: number }
    >();

    for (const g of grouped) {
      if (!g.clientSubscriptionId) continue;
      const seat = seatMap.get(g.clientSubscriptionId);
      if (!seat) continue;

      const amount = Number(g.totalPaid);
      const existing = clientMap.get(seat.clientId);

      if (existing) {
        existing.totalPaid += amount;
        existing.renewalCount += Number(g.count);
      } else {
        clientMap.set(seat.clientId, {
          clientId: seat.clientId,
          clientName: seat.client.name,
          totalPaid: amount,
          renewalCount: Number(g.count),
        });
      }
    }

    const totalRevenue = [...clientMap.values()].reduce(
      (sum, c) => sum + c.totalPaid,
      0,
    );

    // Sort by totalPaid descending and compute weight percentage
    const clients = [...clientMap.values()]
      .sort((a, b) => b.totalPaid - a.totalPaid)
      .map((c) => ({
        ...c,
        weight: totalRevenue > 0 ? (c.totalPaid / totalRevenue) * 100 : 0,
      }));

    return success({ clients, totalRevenue });
  });
}
