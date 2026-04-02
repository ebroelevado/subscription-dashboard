// Apply monkey-patch to fix boolean conversion in Drizzle better-sqlite3 driver
import "./patches/drizzle-boolean-fix";

// @ts-ignore: better-auth export is not correctly typed under bundler moduleResolution
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDirectDb } from "@/db";
import * as schema from "@/db/schema";
import bcrypt from "bcryptjs";

const authSecret = process.env.AUTH_SECRET || "dev-auth-secret-change-in-production";

export const auth = betterAuth({
  baseURL: process.env.AUTH_URL || "http://localhost:3000",
  secret: authSecret,
  database: drizzleAdapter(getDirectDb(), {
    provider: "sqlite",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verificationTokens,
    },
  }),
  user: {
    additionalFields: {
      currency: { type: "string", defaultValue: "EUR" },
      disciplinePenalty: { type: "number", defaultValue: 0.5 },
      usageCredits: { type: "number", defaultValue: 0 },
      companyName: { type: "string", required: false },
      whatsappSignatureMode: { type: "string", defaultValue: "name" },
      plan: { type: "string", defaultValue: "FREE" },
      stripeCustomerId: { type: "string", required: false },
      stripeSubscriptionId: { type: "string", required: false },
      stripePriceId: { type: "string", required: false },
      stripeCurrentPeriodEnd: { type: "string", required: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    password: {
      hash: async (password: string) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ hash, password }: { hash: string; password: string }) => {
        return await bcrypt.compare(password, hash);
      },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  account: {
    // In local dev with mixed runtimes (vinext/next/worker proxy), keeping OAuth state
    // in encrypted cookie is more robust than DB-backed state rows.
    storeStateStrategy: "cookie",
  },
  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days
    updateAge: 5 * 60, // Refresh session every 5 minutes
  },
  // Note: nextCookies() removed — it relies on Next.js internals that are
  // shimmed under vinext and may silently drop session cookies after login.
  plugins: [],
});
