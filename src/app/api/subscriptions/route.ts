import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSubscriptionSchema } from "@/lib/validations";
import { success, withErrorHandling } from "@/lib/api-utils";

// GET /api/subscriptions — List all subscriptions for the authenticated user (optionally filtered by planId)
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId");

    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId,
        ...(planId && { planId }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        plan: {
          select: {
            id: true,
            name: true,
            cost: true,
            maxSeats: true,
            platform: { select: { id: true, name: true } },
          },
        },
        clientSubscriptions: {
          where: { status: "active" },
          select: { id: true, customPrice: true, status: true },
        },
      },
    });
    return success(subscriptions);
  });
}

// POST /api/subscriptions — Create a new subscription for the authenticated user
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { addMonths } = await import("date-fns");

    const body = await request.json();
    const data = createSubscriptionSchema.parse(body);

    const activeUntil = data.isPaid ? addMonths(data.startDate, data.durationMonths) : data.startDate;
    const defaultPaymentNote = data.defaultPaymentNote || "como pago";

    // Create subscription and potentially the initial PlatformRenewal if paid
    const subscription = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          label: data.label,
          startDate: data.startDate,
          activeUntil,
          status: data.status,
          masterUsername: data.masterUsername,
          masterPassword: data.masterPassword,
          isAutopayable: data.isAutopayable,
          defaultPaymentNote,
          user: { connect: { id: userId } },
          plan: { connect: { id: data.planId } },
          ...(data.ownerId && { owner: { connect: { id: data.ownerId } } }),
        },
        include: {
          plan: true,
        },
      });

      if (data.isPaid) {
        // Find how much plan costs
        const planCost = Number(sub.plan.cost);
        const { startOfDay, addDays } = await import("date-fns");
        
        const periodStart = startOfDay(data.startDate);
        const periodEnd = startOfDay(activeUntil);
        const paidOn = startOfDay(new Date());

        await tx.platformRenewal.create({
          data: {
            subscriptionId: sub.id,
            amountPaid: planCost,
            periodStart,
            periodEnd,
            paidOn,
            notes: data.paymentNote || defaultPaymentNote,
          },
        });
      }

      return sub;
    });

    return success(subscription, 201);
  });
}
