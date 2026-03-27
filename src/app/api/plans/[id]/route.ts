import { type NextRequest } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db";
import { plans, platforms, subscriptions, clientSubscriptions } from "@/db/schema";
import { createPlanSchema } from "@/lib/validations";
import { success, error, withErrorHandling } from "@/lib/api-utils";
import { amountToCents } from "@/lib/currency";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/plans/[id]
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const plan = await db.query.plans.findFirst({
      where: and(eq(plans.id, id), eq(plans.userId, userId)),
      with: {
        platform: { columns: { id: true, name: true } },
        subscriptions: {
          columns: {
            id: true,
            label: true,
            status: true,
            activeUntil: true,
          },
        },
      },
    });

    if (!plan) return error("Plan not found", 404);

    // Add clientSubscriptions count to each subscription
    const subscriptionsWithCount = await Promise.all(
      plan.subscriptions.map(async (sub) => {
        const [{ count: csCount }] = await db
          .select({ count: count() })
          .from(clientSubscriptions)
          .where(eq(clientSubscriptions.subscriptionId, sub.id));
        return { ...sub, clientSubscriptionCount: csCount };
      })
    );

    return success({ ...plan, subscriptions: subscriptionsWithCount });
  });
}

// PATCH /api/plans/[id]
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;
    const body = await request.json();
    const data = createPlanSchema.partial().parse(body);

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.cost !== undefined) updateData.cost = amountToCents(data.cost);
    if (data.maxSeats !== undefined) updateData.maxSeats = data.maxSeats;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.platformId !== undefined) updateData.platformId = data.platformId;

    const [plan] = await db.update(plans)
      .set(updateData)
      .where(and(eq(plans.id, id), eq(plans.userId, userId)))
      .returning();
    return success(plan);
  });
}

// DELETE /api/plans/[id]
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    await db.delete(plans).where(and(eq(plans.id, id), eq(plans.userId, userId)));
    return success({ deleted: true });
  });
}
