import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

function getStripeCurrentPeriodEndDate(subscription: unknown): string | undefined {
  const currentPeriodEnd = (subscription as { current_period_end?: unknown }).current_period_end;
  if (typeof currentPeriodEnd !== "number") return undefined;
  return new Date(currentPeriodEnd * 1000).toISOString();
}

function getInvoiceSubscriptionId(invoice: unknown): string | null {
  const legacySubscription = (invoice as { subscription?: unknown }).subscription;
  if (typeof legacySubscription === "string") return legacySubscription;

  const parent = (invoice as { parent?: unknown }).parent;
  if (!parent || typeof parent !== "object") return null;

  const subscriptionFromParent = (
    parent as {
      subscription_details?: { subscription?: unknown };
    }
  ).subscription_details?.subscription;

  return typeof subscriptionFromParent === "string" ? subscriptionFromParent : null;
}

export async function POST(req: Request) {
  const stripe = getStripe();
  const body = await req.text();
  const signature = (await headers()).get("Stripe-Signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return new NextResponse("Webhook Error: Missing signature or webhook secret", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown signature validation error";
    return new NextResponse(`Webhook Error: ${message}`, { status: 400 });
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT NULL,
      error_message TEXT NULL
    )
  `);

  const insertResult = await db.execute(sql`
    INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type)
    VALUES (${event.id}, ${event.type})
  `);

  if (insertResult.meta?.changes === 0) {
    return new NextResponse(null, { status: 200 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
      if (!subscriptionId) {
        throw new Error("Checkout session missing subscription id");
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      const userId = session.metadata?.userId;
      if (!userId) {
        throw new Error("No userId in checkout session metadata");
      }

      await db.update(users).set({
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
        stripePriceId: subscription.items.data[0]?.price.id,
        stripeCurrentPeriodEnd: getStripeCurrentPeriodEndDate(subscription),
        plan: "PREMIUM",
      }).where(eq(users.id, userId));
    }

    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        await db.update(users).set({
          stripePriceId: subscription.items.data[0]?.price.id,
          stripeCurrentPeriodEnd: getStripeCurrentPeriodEndDate(subscription),
          plan: "PREMIUM",
        }).where(eq(users.stripeSubscriptionId, subscription.id));
      }
    }

    if (
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.updated"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const canceled = subscription.status === "canceled" || subscription.status === "unpaid";

      if (canceled) {
        await db.update(users).set({
          plan: "FREE",
          stripeCurrentPeriodEnd: null,
        }).where(eq(users.stripeSubscriptionId, subscription.id));
      } else {
        await db.update(users).set({
          plan: "PREMIUM",
          stripePriceId: subscription.items.data[0]?.price.id,
          stripeCurrentPeriodEnd: getStripeCurrentPeriodEndDate(subscription),
        }).where(eq(users.stripeSubscriptionId, subscription.id));
      }
    }

    await db.execute(sql`
      UPDATE stripe_webhook_events
      SET processed_at = datetime('now'), error_message = NULL
      WHERE event_id = ${event.id}
    `);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Stripe webhook error";
    await db.execute(sql`
      UPDATE stripe_webhook_events
      SET error_message = ${message}
      WHERE event_id = ${event.id}
    `);

    console.error("[STRIPE_WEBHOOK_ERROR]", error);
    return new NextResponse("Webhook processing error", { status: 500 });
  }

  return new NextResponse(null, { status: 200 });
}
