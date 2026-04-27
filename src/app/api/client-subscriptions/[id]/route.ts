import { type NextRequest } from "next/server";
import { eq, and, desc, count } from "drizzle-orm";
import { db } from "@/db";
import { clientSubscriptions, subscriptions, renewalLogs, plans, platforms } from "@/db/schema";
import { success, error, withErrorHandling } from "@/lib/api-utils";
import { amountToCents } from "@/lib/currency";
import { differenceInDays, addDays, startOfDay } from "date-fns";
import { decryptCredential, encryptCredential } from "@/lib/credential-encryption";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/client-subscriptions/[id] — Seat detail with renewal history
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    // First verify ownership through subscription
    const seat = await db.query.clientSubscriptions.findFirst({
      where: eq(clientSubscriptions.id, id),
      with: {
        client: { columns: { id: true, name: true, phone: true } },
        subscription: {
          columns: { userId: true },
          with: {
            plan: {
              with: { platform: { columns: { id: true, name: true } } },
            },
          },
        },
        renewalLogs: {
          orderBy: [desc(renewalLogs.paidOn)],
        },
      },
    });

    if (!seat || seat.subscription.userId !== userId) return error("Seat not found", 404);
    return success({
      ...seat,
      serviceUser: await decryptCredential(seat.serviceUser),
      servicePassword: await decryptCredential(seat.servicePassword),
    });
  });
}

// PATCH /api/client-subscriptions/[id] — Pause / Resume / Cancel / Update price
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    // Verify ownership through the subscription chain
    const existing = await db.query.clientSubscriptions.findFirst({
      where: eq(clientSubscriptions.id, id),
      with: { subscription: { columns: { userId: true } } },
    });
    if (!existing || existing.subscription.userId !== userId) return error("Seat not found", 404);

    const body = await request.json();
    const { updateSeatSchema } = await import("@/lib/validations");
    const data = updateSeatSchema.parse(body);

    const updateData: Record<string, unknown> = {};

    if (data.customPrice !== undefined) updateData.customPrice = amountToCents(data.customPrice);
    if (data.startDate !== undefined) updateData.joinedAt = data.startDate instanceof Date ? data.startDate.toISOString().split("T")[0] : data.startDate;
    if (data.activeUntil !== undefined) updateData.activeUntil = data.activeUntil instanceof Date ? data.activeUntil.toISOString().split("T")[0] : data.activeUntil;

    // Handle credentials (stored on ClientSubscription, not Client)
    if (data.serviceUser !== undefined) updateData.serviceUser = await encryptCredential(data.serviceUser);
    if (data.servicePassword !== undefined) updateData.servicePassword = await encryptCredential(data.servicePassword);
    
    if (data.subscriptionId !== undefined && data.subscriptionId !== existing.subscriptionId) {
      // 1. Verify ownership of the target subscription
      const targetSub = await db.query.subscriptions.findFirst({
        where: and(eq(subscriptions.id, data.subscriptionId), eq(subscriptions.userId, userId)),
        with: { plan: { columns: { maxSeats: true } } },
      });
      if (!targetSub) return error("Target subscription not found or unauthorized", 404);

      // 2. Capacity check for target subscription
      if (targetSub.plan.maxSeats !== null) {
        const [{ currentOccupied }] = await db
          .select({ currentOccupied: count() })
          .from(clientSubscriptions)
          .where(and(
            eq(clientSubscriptions.subscriptionId, data.subscriptionId),
            eq(clientSubscriptions.status, "active")
          ));
        if (currentOccupied >= targetSub.plan.maxSeats) {
          return error(
            `Target subscription is full (${currentOccupied}/${targetSub.plan.maxSeats} seats occupied)`,
            409
          );
        }
      }
      updateData.subscriptionId = data.subscriptionId;
    }

    if (data.autoRenewal !== undefined) updateData.autoRenewal = data.autoRenewal;

    if (data.status !== undefined && data.status !== existing.status) {
      updateData.status = data.status;
      const today = startOfDay(new Date());

      switch (data.status) {
        case "paused": {
          // Calculate remaining paid days and freeze them
          const expiry = startOfDay(new Date(existing.activeUntil));
          const remaining = Math.max(0, differenceInDays(expiry, today));
          updateData.leftAt = today.toISOString().split("T")[0];
          updateData.remainingDays = remaining;
          break;
        }

        case "active": {
          // Resume: restore remaining paid days from today
          const days = existing.remainingDays ?? 0;
          updateData.leftAt = null;
          updateData.activeUntil = days > 0 ? addDays(today, days).toISOString().split("T")[0] : today.toISOString().split("T")[0];
          updateData.remainingDays = null; // clear after use
          break;
        }
      }
    }

    const [seat] = await db.update(clientSubscriptions)
      .set(updateData)
      .where(eq(clientSubscriptions.id, id))
      .returning();
    return success({
      ...seat,
      serviceUser: await decryptCredential(seat.serviceUser),
      servicePassword: await decryptCredential(seat.servicePassword),
    });
  });
}

// DELETE /api/client-subscriptions/[id] — Hard delete a seat
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    // Verify ownership through the subscription chain
    const existing = await db.query.clientSubscriptions.findFirst({
      where: eq(clientSubscriptions.id, id),
      with: { subscription: { columns: { userId: true } } },
    });
    if (!existing || existing.subscription.userId !== userId) return error("Seat not found", 404);

    await db.delete(clientSubscriptions).where(eq(clientSubscriptions.id, id));

    return success({ success: true });
  });
}
