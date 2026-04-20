import { NextResponse } from "next/server";
import { getStripe, getStripeEnv } from "@/lib/stripe";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

function getSubscriptionCustomerId(
  customer: string | { id?: string | null } | null,
): string | null {
  if (typeof customer === "string") {
    return customer;
  }

  if (customer && typeof customer === "object" && typeof customer.id === "string") {
    return customer.id;
  }

  return null;
}

export async function DELETE() {
  try {
    getStripeEnv("STRIPE_SECRET_KEY");
    const stripe = getStripe();
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    if (!user.stripeSubscriptionId) {
      await db.update(users).set({
        plan: "FREE",
        stripePriceId: null,
        stripeCurrentPeriodEnd: null,
      }).where(eq(users.id, userId));

      return NextResponse.json({ ok: true, data: { mode: "already_free" } });
    }

    const subscription = await stripe.subscriptions.cancel(user.stripeSubscriptionId, {
      invoice_now: true,
      prorate: true,
    });

    await db.update(users).set({
      plan: "FREE",
      stripeSubscriptionId: null,
      stripeCustomerId: getSubscriptionCustomerId(subscription.customer) || user.stripeCustomerId,
      stripePriceId: null,
      stripeCurrentPeriodEnd: null,
    }).where(eq(users.id, userId));

    return NextResponse.json({ ok: true, data: { mode: "downgraded" } });
  } catch (error) {
    console.error("[STRIPE_SUBSCRIPTION_DELETE_ERROR]", error);
    const message = error instanceof Error ? error.message : "Internal Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
