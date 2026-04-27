// Apply monkey-patch to fix boolean conversion in Drizzle better-sqlite3 driver
import "./patches/drizzle-boolean-fix";

// @ts-ignore: better-auth export is not correctly typed under bundler moduleResolution
import { betterAuth } from "better-auth";
import { customSession } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDirectDb } from "@/db";
import * as schema from "@/db/schema";
import bcrypt from "bcryptjs";

// Cloudflare Workers environment for email sending
let cfEnv: any = null;
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
  try {
    // Use dynamic string to prevent Vite from resolving this during dev/build
    const cfModule = "cloudflare:workers";
    // @ts-ignore
    import(/* @vite-ignore */ cfModule).then(m => cfEnv = m.env).catch(() => {});
  } catch (e) {}
}

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
      async sendResetPassword({ user, url, token }, request) {
        console.log(`[AUTH] Attempting to send reset email to: ${user.email}`);
        console.log(`[AUTH] Password Reset URL: ${url}`);
        
        try {
          // Dynamic import to avoid issues in Node.js environments
          const cfModule = "cloudflare:workers";
          // @ts-ignore
          let env: any;
          try {
            const m = await import(/* @vite-ignore */ cfModule);
            env = m.env;
          } catch (e) {
            // Fallback for different environments/bundlers
            env = (globalThis as any).process?.env || {};
          }
          
          if (env?.EMAIL) {
            console.log("[AUTH] Using Cloudflare EMAIL binding...");
            
            // Basic RFC 5322 MIME message
            const subject = "Restablecer tu contraseña - Pearfect";
            const fromName = "Pearfect";
            const fromEmail = "auth@pearfect.net";
            
            const mimeMessage = [
              `From: ${fromName} <${fromEmail}>`,
              `To: ${user.email}`,
              `Subject: ${subject}`,
              `MIME-Version: 1.0`,
              `Content-Type: text/plain; charset=utf-8`,
              `Content-Transfer-Encoding: 7bit`,
              ``,
              `Hola,`,
              ``,
              `Haz clic en el siguiente enlace para restablecer tu contraseña:`,
              ``,
              `${url}`,
              ``,
              `Este enlace caducará en 1 hora.`,
              ``,
              `Si no has solicitado este cambio, puedes ignorar este mensaje con seguridad.`
            ].join("\r\n");

            // Cloudflare EmailMessage requires a raw string/Uint8Array
            await env.EMAIL.send(new (globalThis as any).EmailMessage(
              fromEmail,
              user.email,
              mimeMessage
            ));
            
            console.log(`[AUTH] Reset email successfully sent to ${user.email}`);
          } else {
            console.warn("[AUTH] Cloudflare EMAIL binding not found in environment.");
            console.warn("[AUTH] In local development, check your terminal for the reset URL above.");
          }
        } catch (e) {
          console.error("[AUTH] Error during email dispatch:", e);
        }
      },
      revokeSessionsOnPasswordReset: true,
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
        // Explicitly check DB for password existence to avoid relying on 
        // potentially sanitized user object in session callback.
        const dbUser = await getDirectDb().query.users.findFirst({
          where: (u, { eq }) => eq(u.id, user.id),
          columns: { password: true }
        });
        
        return {
          user: {
            ...user,
            hasPassword: !!dbUser?.password,
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
