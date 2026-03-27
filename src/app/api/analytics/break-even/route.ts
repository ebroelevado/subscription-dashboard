import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { success, withErrorHandling } from "@/lib/api-utils";

// GET /api/analytics/break-even — Subscription-group profitability
export async function GET() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const subs = await db.query.subscriptions.findMany({
      where: eq(subscriptions.userId, userId),
      with: {
        plan: {
          with: { platform: { columns: { name: true } } },
        },
        clientSubscriptions: {
          columns: { id: true, status: true },
          with: {
            renewalLogs: { columns: { amountPaid: true } },
          },
        },
        platformRenewals: { columns: { amountPaid: true } },
      },
    });

    type Sub = (typeof subs)[number];
    const result = subs.map((sub: Sub) => {
      const revenue = sub.clientSubscriptions.reduce(
        (sum, cs) =>
          sum +
          cs.renewalLogs.reduce((s, r) => s + Number(r.amountPaid), 0),
        0
      );
      const cost = sub.platformRenewals.reduce(
        (sum, pr) => sum + Number(pr.amountPaid),
        0
      );
      const net = revenue - cost;

      return {
        subscriptionId: sub.id,
        label: sub.label,
        platform: sub.plan.platform.name,
        plan: sub.plan.name,
        revenue,
        cost,
        net,
        profitable: net >= 0,
        activeSeats: sub.clientSubscriptions.filter(
          (cs) => cs.status === "active"
        ).length,
      };
    });

    // Sort: unprofitable first, then by net ascending
    result.sort((a, b) => {
      if (a.profitable !== b.profitable) return a.profitable ? 1 : -1;
      return a.net - b.net;
    });

    return success(result);
  });
}
