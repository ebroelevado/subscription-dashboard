// Apply monkey-patch to fix boolean conversion in Drizzle better-sqlite3 driver
import "./patches/drizzle-boolean-fix";

// @ts-ignore: better-auth export is not correctly typed under bundler moduleResolution
import { betterAuth } from "better-auth";
import { customSession } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDirectDb } from "@/db";
import * as schema from "@/db/schema";
import bcrypt from "bcryptjs";

const authSecret = process.env.AUTH_SECRET || "dev-auth-secret-change-in-production";

type AuthInstance = ReturnType<typeof betterAuth>;

let authInstance: AuthInstance | null = null;

function createAuth(): AuthInstance {
  return betterAuth({
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
        usageCredits: { type: "number", defaultValue: 0 },
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
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60, // 30 days
      updateAge: 5 * 60, // Refresh session every 5 minutes
    },
    // Note: nextCookies() removed — it relies on Next.js internals that are
    // shimmed under vinext and may silently drop session cookies after login.
    plugins: [
      customSession(async ({ user, session }) => {
        return {
          user: {
            ...user,
            hasPassword: !!(user as any).password,
          },
          session,
        };
      }),
    ],
  });
}

export function getAuth(): AuthInstance {
  if (!authInstance) {
    authInstance = createAuth();
  }

  return authInstance;
}

// Backward-compatible lazy proxy for existing imports using `auth`.
export const auth: AuthInstance = new Proxy({} as AuthInstance, {
  get(_target, prop, receiver) {
    const instance = getAuth() as any;
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
