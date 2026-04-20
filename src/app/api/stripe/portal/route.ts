import { NextResponse } from "next/server";
import { getStripe, validateStripeRuntimeConfig } from "@/lib/stripe";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST() {
  try {
    validateStripeRuntimeConfig();
    const stripe = getStripe();
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { stripeCustomerId: true },
    });

    if (!user || !user.stripeCustomerId) {
      return NextResponse.json({ ok: false, error: "Stripe customer not found" }, { status: 404 });
    }

    const origin = process.env.AUTH_URL || "http://localhost:3000";

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/dashboard/settings`,
    });

    return NextResponse.json({ ok: true, url: portalSession.url });
  } catch (error) {
    console.error("[STRIPE_PORTAL_ERROR]", error);
    const message = error instanceof Error ? error.message : "Internal Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
