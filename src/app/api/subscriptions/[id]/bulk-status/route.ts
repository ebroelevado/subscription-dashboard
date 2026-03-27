import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, clientSubscriptions } from "@/db/schema";
import { withErrorHandling, success, error } from "@/lib/api-utils";
import { differenceInDays, addDays, startOfDay } from "date-fns";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const bulkStatusSchema = z.object({
  action: z.enum(["pause", "resume"]),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;
    const body = await request.json();
    const { action } = bulkStatusSchema.parse(body);

    // Verify subscription belongs to user
    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)),
      columns: { id: true },
    });
    if (!sub) return error("Subscription not found", 404);

    const today = startOfDay(new Date());

    if (action === "pause") {
      // First get all active seats to calculate individual remaining days
      const activeSeats = await db.select({
        id: clientSubscriptions.id,
        activeUntil: clientSubscriptions.activeUntil,
      })
        .from(clientSubscriptions)
        .where(and(
          eq(clientSubscriptions.subscriptionId, id),
          eq(clientSubscriptions.status, "active")
        ));

      // Update each seat individually to store its own remaining days
      let count = 0;
      for (const seat of activeSeats) {
        const expiry = startOfDay(new Date(seat.activeUntil));
        const remaining = Math.max(0, differenceInDays(expiry, today));
        await db.update(clientSubscriptions)
          .set({
            status: "paused",
            leftAt: today.toISOString().split("T")[0],
            remainingDays: remaining,
          })
          .where(eq(clientSubscriptions.id, seat.id));
        count++;
      }
      return success({ updated: count, action: "paused" });
    }

    // Resume all paused seats — restore their individual remaining days
    const pausedSeats = await db.select({
      id: clientSubscriptions.id,
      remainingDays: clientSubscriptions.remainingDays,
    })
      .from(clientSubscriptions)
      .where(and(
        eq(clientSubscriptions.subscriptionId, id),
        eq(clientSubscriptions.status, "paused")
      ));

    let count = 0;
    for (const seat of pausedSeats) {
      const days = seat.remainingDays ?? 0;
      await db.update(clientSubscriptions)
        .set({
          status: "active",
          leftAt: null,
          activeUntil: days > 0 ? addDays(today, days).toISOString().split("T")[0] : today.toISOString().split("T")[0],
          remainingDays: null,
        })
        .where(eq(clientSubscriptions.id, seat.id));
      count++;
    }
    return success({ updated: count, action: "resumed" });
  });
}
