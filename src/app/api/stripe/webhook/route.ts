import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe, getStripeEnv } from "@/lib/stripe";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const HANDLED_EVENTS = new Set<string>([
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "customer.subscription.deleted",
  "customer.subscription.updated",
]);

const DOWNGRADE_STATUSES = new Set<string>([
  "canceled",
  "unpaid",
  "past_due",
  "incomplete_expired",
]);

function getStripeCurrentPeriodEndDate(subscription: unknown): string | undefined {
  const currentPeriodEnd = (subscription as { current_period_end?: unknown }).current_period_end;
  if (typeof currentPeriodEnd !== "number") return undefined;
  return new Date(currentPeriodEnd * 1000).toISOString();
}

function getStripeEntityId(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") {
      return id;
    }
  }

  return null;
}

function getInvoiceSubscriptionId(invoice: unknown): string | null {
  const legacySubscription = getStripeEntityId((invoice as { subscription?: unknown }).subscription);
  if (legacySubscription) return legacySubscription;

  const parent = (invoice as { parent?: unknown }).parent;
  if (!parent || typeof parent !== "object") return null;

  const subscriptionFromParent = (
    parent as {
      subscription_details?: { subscription?: unknown };
    }
  ).subscription_details?.subscription;

  return getStripeEntityId(subscriptionFromParent);
}

export async function POST(req: Request) {
  const stripe = getStripe();
  const body = await req.text();
  const signature = (await headers()).get("Stripe-Signature");
  let webhookSecret: string;

  try {
    webhookSecret = getStripeEnv("STRIPE_WEBHOOK_SECRET");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing Stripe webhook configuration";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (!signature) {
    return NextResponse.json({ ok: false, error: "Missing Stripe-Signature header" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown signature validation error";
    return NextResponse.json({ ok: false, error: `Webhook Error: ${message}` }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return new NextResponse(null, { status: 200 });
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

  const existingEventResult = await db.execute(sql`
    SELECT processed_at AS processedAt, error_message AS errorMessage
    FROM stripe_webhook_events
    WHERE event_id = ${event.id}
    LIMIT 1
  `);

  const existingEvent = (existingEventResult.rows?.[0] ?? null) as
    | { processedAt?: string | null; errorMessage?: string | null }
    | null;

  if (existingEvent?.processedAt) {
    return new NextResponse(null, { status: 200 });
  }

  if (!existingEvent) {
    await db.execute(sql`
      INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type)
      VALUES (${event.id}, ${event.type})
    `);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = getStripeEntityId(session.subscription);
      if (!subscriptionId) {
        throw new Error("Checkout session missing subscription id");
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      let userId = session.metadata?.userId;
      if (!userId) {
        const sessionCustomerId = getStripeEntityId(session.customer);
        if (sessionCustomerId) {
          const userByCustomer = await db.query.users.findFirst({
            where: eq(users.stripeCustomerId, sessionCustomerId),
            columns: { id: true },
          });
          userId = userByCustomer?.id;
        }
      }

      if (!userId) {
        throw new Error("No userId in checkout session metadata");
      }

      const subscriptionPriceId = subscription.items.data[0]?.price?.id ?? null;

      await db.update(users).set({
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: getStripeEntityId(subscription.customer),
        stripePriceId: subscriptionPriceId,
        stripeCurrentPeriodEnd: getStripeCurrentPeriodEndDate(subscription),
        plan: "PREMIUM",
      }).where(eq(users.id, userId));
    }

    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const subscriptionPriceId = subscription.items.data[0]?.price?.id ?? null;

        await db.update(users).set({
          stripePriceId: subscriptionPriceId,
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
      const subscriptionPriceId = subscription.items.data[0]?.price?.id ?? null;
      const downgraded = DOWNGRADE_STATUSES.has(subscription.status);

      if (downgraded) {
        await db.update(users).set({
          plan: "FREE",
          stripePriceId: null,
          stripeCurrentPeriodEnd: null,
        }).where(eq(users.stripeSubscriptionId, subscription.id));
      } else {
        await db.update(users).set({
          plan: "PREMIUM",
          stripePriceId: subscriptionPriceId,
          stripeCustomerId: getStripeEntityId(subscription.customer),
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
      SET processed_at = NULL, error_message = ${message}
      WHERE event_id = ${event.id}
    `);

    console.error("[STRIPE_WEBHOOK_ERROR]", error);
    return NextResponse.json({ ok: false, error: "Webhook processing error" }, { status: 500 });
  }

  return new NextResponse(null, { status: 200 });
}
