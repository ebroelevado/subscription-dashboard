import { type NextRequest } from "next/server";
import { eq, and, desc, asc, count, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, plans, clients, clientSubscriptions, platformRenewals } from "@/db/schema";
import { createSubscriptionSchema } from "@/lib/validations";
import { success, error, withErrorHandling } from "@/lib/api-utils";
import { decryptCredential, encryptCredential } from "@/lib/credential-encryption";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/subscriptions/[id] — Full subscription detail with seats
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const subscription = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)),
      with: {
        plan: {
          with: { platform: { columns: { id: true, name: true } } },
        },
        clientSubscriptions: {
          orderBy: [asc(clientSubscriptions.joinedAt)],
          with: {
            client: true,
          },
        },
        platformRenewals: {
          orderBy: [desc(platformRenewals.paidOn)],
          limit: 10,
        },
      },
    });

    if (!subscription) return error("Subscription not found", 404);

    return success({
      ...subscription,
      clientSubscriptions: await Promise.all(subscription.clientSubscriptions.map(async (seat) => ({
        ...seat,
        serviceUser: await decryptCredential(seat.serviceUser),
        servicePassword: await decryptCredential(seat.servicePassword),
      }))),
    });
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
    if (data.startDate !== undefined) updateData.startDate = data.startDate instanceof Date ? data.startDate.toISOString().split("T")[0] : data.startDate;
    if (data.durationMonths !== undefined && data.startDate) {
      const newActiveUntil = addMonths(data.startDate, data.durationMonths);
      updateData.activeUntil = newActiveUntil instanceof Date ? newActiveUntil.toISOString().split("T")[0] : newActiveUntil;
    }
    
    // Allow clearing these fields by checking against undefined (so null sets them to null)
    if (data.masterUsername !== undefined) updateData.masterUsername = data.masterUsername;
    if (data.masterPassword !== undefined) updateData.masterPassword = await encryptCredential(data.masterPassword);
    if (data.ownerId !== undefined) {
      if (data.ownerId) {
        const owner = await db.query.clients.findFirst({
          where: and(eq(clients.id, data.ownerId), eq(clients.userId, userId)),
          columns: { id: true },
        });
        if (!owner) return error("Owner client not found", 404);
      }
      updateData.ownerId = data.ownerId;
    }
    if (data.isAutopayable !== undefined) updateData.isAutopayable = data.isAutopayable;

    // If planId is changing, enforce capacity check
    if (data.planId) {
      const newPlan = await db.query.plans.findFirst({
        where: and(eq(plans.id, data.planId), eq(plans.userId, userId)),
        columns: { maxSeats: true },
      });
      if (!newPlan) return error("Plan not found", 404);

      if (newPlan.maxSeats !== null) {
        const [{ occupied }] = await db
          .select({ occupied: count() })
          .from(clientSubscriptions)
          .where(and(
            eq(clientSubscriptions.subscriptionId, id),
            inArray(clientSubscriptions.status, ["active", "paused"])
          ));
        if (occupied > newPlan.maxSeats) {
          return error(
            `Cannot switch plan: ${occupied} seats occupied but new plan allows only ${newPlan.maxSeats}`,
            409
          );
        }
      }
      updateData.planId = data.planId;
    }

    const [subscription] = await db.update(subscriptions)
      .set(updateData)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .returning();
    return success(subscription);
  });
}

// DELETE /api/subscriptions/[id]
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    await db.delete(subscriptions).where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)));
    return success({ deleted: true });
  });
}
