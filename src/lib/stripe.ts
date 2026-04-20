import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripeEnv(name: "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET" | "STRIPE_PREMIUM_PRICE_ID"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing from environment variables`);
  }
  return value;
}

export function validateStripeRuntimeConfig() {
  getStripeEnv("STRIPE_SECRET_KEY");
  getStripeEnv("STRIPE_PREMIUM_PRICE_ID");
}

export function getStripe() {
  const secretKey = getStripeEnv("STRIPE_SECRET_KEY");

  if (!stripeInstance) {
    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2026-03-25.dahlia",
      typescript: true,
    });
  }

  return stripeInstance;
}
