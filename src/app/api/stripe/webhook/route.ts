import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
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

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ NULL,
      error_message TEXT NULL
    )
  `);

  const insertedRows = await prisma.$executeRaw`
    INSERT INTO stripe_webhook_events (event_id, event_type)
    VALUES (${event.id}, ${event.type})
    ON CONFLICT (event_id) DO NOTHING
  `;

  if (insertedRows === 0) {
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

      await prisma.user.update({
        where: { id: userId },
        data: {
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
          stripePriceId: subscription.items.data[0]?.price.id,
          stripeCurrentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : undefined,
          plan: "PREMIUM",
        },
      });
    }

    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            stripePriceId: subscription.items.data[0]?.price.id,
            stripeCurrentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : undefined,
            plan: "PREMIUM",
          },
        });
      }
    }

    if (
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.updated"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const canceled = subscription.status === "canceled" || subscription.status === "unpaid";

      if (canceled) {
        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            plan: "FREE",
            stripeCurrentPeriodEnd: null,
          },
        });
      } else {
        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            plan: "PREMIUM",
            stripePriceId: subscription.items.data[0]?.price.id,
            stripeCurrentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : undefined,
          },
        });
      }
    }

    await prisma.$executeRaw`
      UPDATE stripe_webhook_events
      SET processed_at = NOW(), error_message = NULL
      WHERE event_id = ${event.id}
    `;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Stripe webhook error";
    await prisma.$executeRaw`
      UPDATE stripe_webhook_events
      SET error_message = ${message}
      WHERE event_id = ${event.id}
    `;

    console.error("[STRIPE_WEBHOOK_ERROR]", error);
    return new NextResponse("Webhook processing error", { status: 500 });
  }

  return new NextResponse(null, { status: 200 });
}
