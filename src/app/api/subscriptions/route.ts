import { type NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, plans, clients, clientSubscriptions, platformRenewals } from "@/db/schema";
import { createSubscriptionSchema } from "@/lib/validations";
import { success, withErrorHandling, error } from "@/lib/api-utils";
import { amountToCents } from "@/lib/currency";
import { checkSubscriptionLimit } from "@/lib/saas-limits";
import { encryptCredential } from "@/lib/credential-encryption";

// GET /api/subscriptions — List all subscriptions for the authenticated user (optionally filtered by planId)
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId");

    const subsList = await db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.userId, userId),
        planId ? eq(subscriptions.planId, planId) : undefined
      ),
      orderBy: [desc(subscriptions.createdAt)],
      with: {
        plan: {
          columns: { id: true, name: true, cost: true, maxSeats: true },
          with: { platform: { columns: { id: true, name: true } } },
        },
        clientSubscriptions: {
          where: eq(clientSubscriptions.status, "active"),
          columns: { id: true, customPrice: true, status: true },
        },
      },
    });
    return success(subsList);
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

    const plan = await db.query.plans.findFirst({
      where: and(eq(plans.id, data.planId), eq(plans.userId, userId)),
      columns: { id: true },
    });

    if (!plan) {
      return error("Plan not found", 404);
    }

    if (data.ownerId) {
      const owner = await db.query.clients.findFirst({
        where: and(eq(clients.id, data.ownerId), eq(clients.userId, userId)),
        columns: { id: true },
      });

      if (!owner) {
        return error("Owner client not found", 404);
      }
    }

    const limitCheck = await checkSubscriptionLimit(userId);
    if (!limitCheck.canCreate) {
      return error(limitCheck.message || "Subscription limit reached", 403);
    }

    const activeUntil = data.isPaid ? addMonths(data.startDate, data.durationMonths) : data.startDate;
    const defaultPaymentNote = data.defaultPaymentNote || "como pago";

    // Create subscription and potentially the initial PlatformRenewal if paid
    const subscription = await db.transaction(async (tx) => {
      const [sub] = await tx.insert(subscriptions).values({
        label: data.label,
        startDate: data.startDate instanceof Date ? data.startDate.toISOString().split("T")[0] : data.startDate,
        activeUntil: activeUntil instanceof Date ? activeUntil.toISOString().split("T")[0] : activeUntil,
        status: data.status,
        masterUsername: data.masterUsername,
        masterPassword: await encryptCredential(data.masterPassword),
        isAutopayable: data.isAutopayable,
        defaultPaymentNote,
        userId,
        planId: data.planId,
        ownerId: data.ownerId ?? null,
      }).returning();

      // Fetch the plan cost
      const planData = await tx.query.plans.findFirst({
        where: eq(plans.id, data.planId),
        columns: { cost: true },
      });

      if (data.isPaid && planData) {
        const planCost = Number(planData.cost);
        const { startOfDay, addDays } = await import("date-fns");
        
        const periodStart = startOfDay(data.startDate);
        const periodEnd = startOfDay(activeUntil);
        const paidOn = startOfDay(new Date());

        await tx.insert(platformRenewals).values({
          subscriptionId: sub.id,
          amountPaid: amountToCents(planCost),
          periodStart: periodStart.toISOString().split("T")[0],
          periodEnd: periodEnd.toISOString().split("T")[0],
          paidOn: paidOn.toISOString().split("T")[0],
          notes: data.paymentNote || defaultPaymentNote,
        });
      }

      return sub;
    });

    return success(subscription, 201);
  });
}
