import { success, withErrorHandling } from "@/lib/api-utils";
import { NextRequest } from "next/server";
import { getDisciplineAnalytics } from "@/lib/discipline-service";

// GET /api/analytics/discipline — Granular payment discipline analysis
// Supports optional filters: planId, subscriptionId, clientId
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const url = new URL(req.url);
    const planId = url.searchParams.get("planId") ?? undefined;
    const subscriptionId = url.searchParams.get("subscriptionId") ?? undefined;
    const clientId = url.searchParams.get("clientId") ?? undefined;

    const data = await getDisciplineAnalytics(userId, { clientId, subscriptionId, planId });
    
    // If filtering by client, there should be exactly one entry in perClient
    const clientEntry = clientId ? data.perClient[clientId] : Object.values(data.perClient)[0];

    if (!clientEntry) {
      return success({
        totalPayments: 0,
        onTimeCount: 0,
        lateCount: 0,
        onTimeRate: 100,
        avgDaysLate: 0,
        score: 10
      });
    }

    return success({
      totalPayments: clientEntry.totalPayments,
      onTimeCount: clientEntry.onTimeCount,
      lateCount: clientEntry.lateCount,
      onTimeRate: clientEntry.onTimeRate,
      avgDaysLate: clientEntry.avgDaysLate,
      score: clientEntry.score ?? 10,
    });
  });
}
