import { prisma } from "@/lib/prisma";
import { success, withErrorHandling } from "@/lib/api-utils";
import { getDisciplineAnalytics } from "@/lib/discipline-service";

// GET /api/analytics/clients-discipline — Batch discipline stats per client
// Returns: { [clientId]: { avgDaysLate, onTimeRate, totalPayments, score } }
export async function GET() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const data = await getDisciplineAnalytics(userId);
    return success(data);
  });
}
