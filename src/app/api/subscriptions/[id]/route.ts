import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSubscriptionSchema } from "@/lib/validations";
import { success, error, withErrorHandling } from "@/lib/api-utils";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/subscriptions/[id] — Full subscription detail with seats
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const subscription = await prisma.subscription.findUnique({
      where: { id, userId },
      include: {
        plan: {
          include: { platform: { select: { id: true, name: true } } },
        },
        clientSubscriptions: {
          include: {
            client: { select: { id: true, name: true, phone: true, serviceUser: true, servicePassword: true } },
          },
          orderBy: { joinedAt: "asc" },
        },
        platformRenewals: {
          orderBy: { paidOn: "desc" },
          take: 10,
        },
      },
    });

    if (!subscription) return error("Subscription not found", 404);
    return success(subscription);
  });
}

// PATCH /api/subscriptions/[id]
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;
    const { addMonths } = await import("date-fns");

    const body = await request.json();
    const data = createSubscriptionSchema.partial().parse(body);

    const updateData: Record<string, unknown> = {};
    if (data.label !== undefined) updateData.label = data.label;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.durationMonths !== undefined && data.startDate) {
      updateData.activeUntil = addMonths(data.startDate, data.durationMonths);
    }
    
    // Allow clearing these fields by checking against undefined (so null sets them to null)
    if (data.masterUsername !== undefined) updateData.masterUsername = data.masterUsername;
    if (data.masterPassword !== undefined) updateData.masterPassword = data.masterPassword;
    if (data.ownerId !== undefined) {
      updateData.owner = data.ownerId ? { connect: { id: data.ownerId } } : { disconnect: true };
    }
    if (data.isAutopayable !== undefined) updateData.isAutopayable = data.isAutopayable;

    // If planId is changing, enforce capacity check
    if (data.planId) {
      const newPlan = await prisma.plan.findUnique({
        where: { id: data.planId, userId },
        select: { maxSeats: true },
      });
      if (!newPlan) return error("Plan not found", 404);

      if (newPlan.maxSeats !== null) {
        const occupied = await prisma.clientSubscription.count({
          where: { subscriptionId: id, status: { in: ["active", "paused"] } },
        });
        if (occupied > newPlan.maxSeats) {
          return error(
            `Cannot switch plan: ${occupied} seats occupied but new plan allows only ${newPlan.maxSeats}`,
            409
          );
        }
      }
      updateData.plan = { connect: { id: data.planId } };
    }

    const subscription = await prisma.subscription.update({
      where: { id, userId },
      data: updateData,
    });
    return success(subscription);
  });
}

// DELETE /api/subscriptions/[id]
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    await prisma.subscription.delete({ where: { id, userId } });
    return success({ deleted: true });
  });
}
