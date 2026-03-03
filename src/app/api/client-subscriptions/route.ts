import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClientSubscriptionSchema } from "@/lib/validations";
import { success, error, withErrorHandling } from "@/lib/api-utils";
import { addMonths, startOfDay } from "date-fns";

// GET /api/client-subscriptions — List all seats (scoped via subscription.userId)
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const subscriptionId = searchParams.get("subscriptionId");
    const status = searchParams.get("status");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { subscription: { userId } };
    if (clientId) where.clientId = clientId;
    if (subscriptionId) where.subscriptionId = subscriptionId;
    if (status) where.status = status;

    const seats = await prisma.clientSubscription.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true } },
        subscription: {
          include: {
            plan: {
              include: { platform: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });
    return success(seats);
  });
}

// POST /api/client-subscriptions — Assign a client to a seat
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const body = await request.json();
    const data = createClientSubscriptionSchema.parse(body);

    // Verify subscription belongs to this user
    const subscription = await prisma.subscription.findUnique({
      where: { id: data.subscriptionId, userId },
      include: { plan: { select: { maxSeats: true } } },
    });

    if (!subscription) {
      return error("Subscription not found", 404);
    }

    // Verify client belongs to this user
    const client = await prisma.client.findUnique({
      where: { id: data.clientId, userId },
    });

    if (!client) {
      return error("Client not found", 404);
    }

    // Unique constraint: reject if client already has an active or paused seat
    const existingSeat = await prisma.clientSubscription.findFirst({
      where: {
        clientId: data.clientId,
        subscriptionId: data.subscriptionId,
        status: { in: ["active", "paused"] },
      },
    });
    if (existingSeat) {
      return error(
        "This client already has an active or paused seat in this subscription",
        409
      );
    }

    // Capacity check (if max_seats is defined)
    if (subscription.plan.maxSeats !== null) {
      const currentOccupied = await prisma.clientSubscription.count({
        where: { subscriptionId: data.subscriptionId, status: "active" },
      });
      if (currentOccupied >= subscription.plan.maxSeats) {
        return error(
          `Subscription is full (${currentOccupied}/${subscription.plan.maxSeats} seats occupied)`,
          409
        );
      }
    }

    // Compute dates from duration
    const startDate = data.startDate ? startOfDay(data.startDate) : startOfDay(new Date());
    const activeUntil = addMonths(startDate, data.durationMonths);

    const seat = await prisma.clientSubscription.create({
      data: {
        clientId: data.clientId,
        subscriptionId: data.subscriptionId,
        customPrice: data.customPrice,
        activeUntil,
        joinedAt: startDate,
        status: data.status,
        serviceUser: data.serviceUser || null,
        servicePassword: data.servicePassword || null,
      },
    });
    return success(seat, 201);
  });
}
