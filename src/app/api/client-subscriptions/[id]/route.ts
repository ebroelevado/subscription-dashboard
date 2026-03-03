import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { success, error, withErrorHandling } from "@/lib/api-utils";
import { differenceInDays, addDays, startOfDay } from "date-fns";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/client-subscriptions/[id] — Seat detail with renewal history
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const seat = await prisma.clientSubscription.findFirst({
      where: { id, subscription: { userId } },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        subscription: {
          include: {
            plan: {
              include: { platform: { select: { id: true, name: true } } },
            },
          },
        },
        renewalLogs: {
          orderBy: { paidOn: "desc" },
        },
      },
    });

    if (!seat) return error("Seat not found", 404);
    return success(seat);
  });
}

// PATCH /api/client-subscriptions/[id] — Pause / Resume / Cancel / Update price
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    // Verify ownership through the subscription chain
    const existing = await prisma.clientSubscription.findFirst({
      where: { id, subscription: { userId } },
    });
    if (!existing) return error("Seat not found", 404);

    const body = await request.json();
    const { updateSeatSchema } = await import("@/lib/validations");
    const data = updateSeatSchema.parse(body);

    const updateData: Record<string, unknown> = {};

    if (data.customPrice !== undefined) updateData.customPrice = data.customPrice;
    if (data.startDate !== undefined) updateData.joinedAt = data.startDate;
    if (data.activeUntil !== undefined) updateData.activeUntil = data.activeUntil;

    // Handle credentials (update Client model)
    if (data.serviceUser !== undefined || data.servicePassword !== undefined) {
      const clientUpdate: Record<string, string | null> = {};
      if (data.serviceUser !== undefined) clientUpdate.serviceUser = data.serviceUser;
      if (data.servicePassword !== undefined) clientUpdate.servicePassword = data.servicePassword;
      
      await prisma.client.update({
        where: { id: existing.clientId },
        data: clientUpdate,
      });
    }

    if (data.status !== undefined && data.status !== existing.status) {
      updateData.status = data.status;
      const today = startOfDay(new Date());

      switch (data.status) {
        case "paused": {
          // Calculate remaining paid days and freeze them
          const expiry = startOfDay(new Date(existing.activeUntil));
          const remaining = Math.max(0, differenceInDays(expiry, today));
          updateData.leftAt = today;
          updateData.remainingDays = remaining;
          break;
        }

        case "active": {
          // Resume: restore remaining paid days from today
          const days = existing.remainingDays ?? 0;
          updateData.leftAt = null;
          updateData.activeUntil = days > 0 ? addDays(today, days) : today;
          updateData.remainingDays = null; // clear after use
          break;
        }
      }
    }

    const seat = await prisma.clientSubscription.update({
      where: { id },
      data: updateData,
    });
    return success(seat);
  });
}

// DELETE /api/client-subscriptions/[id] — Hard delete a seat
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const existing = await prisma.clientSubscription.findFirst({
      where: { id, subscription: { userId } },
    });
    if (!existing) return error("Seat not found", 404);

    await prisma.clientSubscription.delete({
      where: { id },
    });

    return success({ success: true });
  });
}
