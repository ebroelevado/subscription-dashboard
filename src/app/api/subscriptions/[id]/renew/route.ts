import { type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { renewPlatformSubscriptionSchema } from "@/lib/validations";
import { renewPlatformSubscription } from "@/lib/services/renewals";
import { success, error, withErrorHandling } from "@/lib/api-utils";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/subscriptions/[id]/renew — I pay the platform → Extend 1 month
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    // Verify subscription belongs to this user
    const subscription = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)),
    });
    if (!subscription) return error("Subscription not found", 404);

    const body = await request.json();
    const data = renewPlatformSubscriptionSchema.parse(body);

    const result = await renewPlatformSubscription({
      subscriptionId: id,
      amountPaid: data.amountPaid,
      notes: data.notes,
    });

    return success(result, 201);
  });
}
