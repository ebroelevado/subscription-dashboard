import { NextResponse } from "next/server";
import { getStripe, getStripeEnv, validateStripeRuntimeConfig } from "@/lib/stripe";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

function isValidPriceId(value: string): boolean {
  return value.startsWith("price_");
}

function getCurrentPeriodEndDate(epochSeconds: number | null | undefined): string | null {
  if (typeof epochSeconds !== "number") {
    return null;
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function getSubscriptionCurrentPeriodEndDate(subscription: unknown): string | null {
  const rawPeriodEnd = (subscription as { current_period_end?: unknown }).current_period_end;
  if (typeof rawPeriodEnd !== "number") {
    return null;
  }

  return getCurrentPeriodEndDate(rawPeriodEnd);
}

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

export async function POST() {
  try {
    validateStripeRuntimeConfig();
    const stripe = getStripe();
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const premiumPriceId = getStripeEnv("STRIPE_PREMIUM_PRICE_ID");

    if (!isValidPriceId(premiumPriceId)) {
      return NextResponse.json(
        { ok: false, error: "Billing configuration invalid (premium price id)." },
        { status: 500 },
      );
    }

    // 1. Get or create Stripe Customer
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    // Existing subscription path: update price with immediate proration instead of creating duplicates.
    if (user.stripeSubscriptionId) {
      let currentSubscription: Awaited<ReturnType<typeof stripe.subscriptions.retrieve>> | null = null;

      try {
        currentSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      } catch (error) {
        console.warn("[STRIPE_CHECKOUT_UPDATE_FALLBACK]", error);
      }

      if (currentSubscription) {
        const subscriptionItem = currentSubscription.items.data[0];
        const currentPriceId = subscriptionItem?.price?.id ?? null;

        if (!subscriptionItem?.id) {
          throw new Error("Existing subscription has no item to update");
        }

        if (currentPriceId === premiumPriceId) {
          await db.update(users).set({
            plan: "PREMIUM",
            stripeCustomerId: getSubscriptionCustomerId(currentSubscription.customer),
            stripePriceId: currentPriceId,
            stripeCurrentPeriodEnd: getSubscriptionCurrentPeriodEndDate(currentSubscription),
          }).where(eq(users.id, userId));

          return NextResponse.json({ ok: true, data: { mode: "already_premium" } });
        }

        const updatedSubscription = await stripe.subscriptions.update(currentSubscription.id, {
          items: [{ id: subscriptionItem.id, price: premiumPriceId }],
          proration_behavior: "always_invoice",
          payment_behavior: "allow_incomplete",
          metadata: {
            userId,
          },
        });

        await db.update(users).set({
          plan: "PREMIUM",
          stripeSubscriptionId: updatedSubscription.id,
          stripeCustomerId: getSubscriptionCustomerId(updatedSubscription.customer),
          stripePriceId: updatedSubscription.items.data[0]?.price?.id ?? premiumPriceId,
          stripeCurrentPeriodEnd: getSubscriptionCurrentPeriodEndDate(updatedSubscription),
        }).where(eq(users.id, userId));

        return NextResponse.json({ ok: true, data: { mode: "updated" } });
      }
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: {
          userId,
        },
      });

      await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, userId));

      customerId = customer.id;
    }

    // 2. Create Checkout Session
    const origin = process.env.AUTH_URL || "http://localhost:3000";

    const stripeSession = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: premiumPriceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${origin}/dashboard/settings?success=true`,
      cancel_url: `${origin}/dashboard/settings?canceled=true`,
      metadata: {
        userId,
      },
    });

    return NextResponse.json({ ok: true, url: stripeSession.url });
  } catch (error) {
    console.error("[STRIPE_CHECKOUT_ERROR]", error);
    const message = error instanceof Error ? error.message : "Internal Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
