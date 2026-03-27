import { type NextRequest } from "next/server";
import { eq, and, asc, inArray, count } from "drizzle-orm";
import { db } from "@/db";
import { clientSubscriptions, subscriptions, clients, renewalLogs, plans, platforms } from "@/db/schema";
import { createClientSubscriptionSchema } from "@/lib/validations";
import { success, error, withErrorHandling } from "@/lib/api-utils";
import { amountToCents } from "@/lib/currency";
import { addMonths, startOfDay } from "date-fns";
import { decryptCredential, encryptCredential } from "@/lib/credential-encryption";

// GET /api/client-subscriptions — List all seats (scoped via subscription.userId)
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const subscriptionId = searchParams.get("subscriptionId");
    const status = searchParams.get("status");

    // Get subscription IDs that belong to this user
    const userSubs = await db.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));
    const userSubIds = userSubs.map(s => s.id);

    if (userSubIds.length === 0) return success([]);

    const conditions = [inArray(clientSubscriptions.subscriptionId, userSubIds)];
    if (clientId) conditions.push(eq(clientSubscriptions.clientId, clientId));
    if (subscriptionId) conditions.push(eq(clientSubscriptions.subscriptionId, subscriptionId));
    if (status) conditions.push(eq(clientSubscriptions.status, status as any));

    const seats = await db.query.clientSubscriptions.findMany({
      where: and(...conditions),
      orderBy: [asc(clientSubscriptions.joinedAt)],
      with: {
        client: { columns: { id: true, name: true, phone: true } },
        subscription: {
          with: {
            plan: {
              with: { platform: { columns: { id: true, name: true } } },
            },
          },
        },
      },
    });

    const remappedSeats = await Promise.all(seats.map(async (seat) => ({
      ...seat,
      serviceUser: await decryptCredential(seat.serviceUser),
      servicePassword: await decryptCredential(seat.servicePassword),
    })));

    return success(remappedSeats);
  });
}

// POST /api/client-subscriptions — Assign a client to a seat
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const body = await request.json();
    const data = createClientSubscriptionSchema.parse(body);

    const { checkUserLimits } = await import("@/lib/saas-limits");
    const limitCheck = await checkUserLimits(userId);
    if (!limitCheck.canCreate && limitCheck.type === "SEATS") {
      throw new Error(limitCheck.message);
    }

    // Verify subscription belongs to this user
    const subscription = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.id, data.subscriptionId), eq(subscriptions.userId, userId)),
      with: { plan: { columns: { maxSeats: true } } },
    });

    if (!subscription) {
      return error("Subscription not found", 404);
    }

    // Verify client belongs to this user
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, data.clientId), eq(clients.userId, userId)),
    });

    if (!client) {
      return error("Client not found", 404);
    }

    // Unique constraint: reject if client already has an active or paused seat
    const existingSeat = await db.query.clientSubscriptions.findFirst({
      where: and(
        eq(clientSubscriptions.clientId, data.clientId),
        eq(clientSubscriptions.subscriptionId, data.subscriptionId),
        inArray(clientSubscriptions.status, ["active", "paused"])
      ),
    });
    if (existingSeat) {
      return error(
        "This client already has an active or paused seat in this subscription",
        409
      );
    }

    // Capacity check (if max_seats is defined)
    if (subscription.plan.maxSeats !== null) {
      const [{ currentOccupied }] = await db
        .select({ currentOccupied: count() })
        .from(clientSubscriptions)
        .where(and(
          eq(clientSubscriptions.subscriptionId, data.subscriptionId),
          eq(clientSubscriptions.status, "active")
        ));
      if (currentOccupied >= subscription.plan.maxSeats) {
        return error(
          `Subscription is full (${currentOccupied}/${subscription.plan.maxSeats} seats occupied)`,
          409
        );
      }
    }

    // Compute dates from duration
    const startDate = data.startDate ? startOfDay(data.startDate) : startOfDay(new Date());
    const activeUntil = data.isPaid ? addMonths(startDate, data.durationMonths) : startDate;

    const defaultPaymentNote = subscription.defaultPaymentNote || "como pago";

    const seat = await db.transaction(async (tx) => {
      const [newSeat] = await tx.insert(clientSubscriptions).values({
        clientId: data.clientId,
        subscriptionId: data.subscriptionId,
        customPrice: amountToCents(data.customPrice),
        activeUntil: activeUntil.toISOString().split("T")[0],
        joinedAt: startDate.toISOString().split("T")[0],
        status: "active",
        serviceUser: await encryptCredential(data.serviceUser),
        servicePassword: await encryptCredential(data.servicePassword),
      }).returning();

      if (data.isPaid) {
        const periodStart = startDate;
        const periodEnd = activeUntil;
        const paidOn = startOfDay(new Date());

        await tx.insert(renewalLogs).values({
          clientSubscriptionId: newSeat.id,
          amountPaid: amountToCents(data.customPrice),
          expectedAmount: amountToCents(data.customPrice),
          periodStart: periodStart.toISOString().split("T")[0],
          periodEnd: periodEnd.toISOString().split("T")[0],
          paidOn: paidOn.toISOString().split("T")[0],
          dueOn: startDate.toISOString().split("T")[0],
          monthsRenewed: data.durationMonths,
          notes: data.paymentNote || defaultPaymentNote,
        });
      }

      return newSeat;
    });

    return success(
      {
        ...seat,
        serviceUser: await decryptCredential(seat.serviceUser),
        servicePassword: await decryptCredential(seat.servicePassword),
      },
      201
    );
  });
}
