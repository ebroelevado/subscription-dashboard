import type { NextAuthConfig } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      hasPassword?: boolean;
      isOAuth?: boolean;
      currency?: string;
      disciplinePenalty?: number;
      companyName?: string | null;
      whatsappUseCompany?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    hasPassword?: boolean;
    isOAuth?: boolean;
    currency?: string;
    disciplinePenalty?: number;
    companyName?: string | null;
    whatsappSignatureMode?: string;
    lastSyncAt?: number;
  }
}


// Determine environment for secure prefixes
const useSecureCookies = process.env.NODE_ENV === "production";
const cookiePrefix = useSecureCookies ? "__Secure-" : "";
const hostPrefix = useSecureCookies ? "__Host-" : "";

// Separate auth config that is edge-compatible (no Prisma/Node specifics)
export const authConfig = {
  trustHost: true,
  session: { 
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: `${cookiePrefix}authjs.callback-url`,
      options: {
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: `${hostPrefix}authjs.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  // Removed pages: { signIn: "/login" } so NextAuth doesn't enforce redirects early in middleware. 
  // We handle routing dynamically per locale in middleware.ts.

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    // We provide an empty list here or just dummy providers
    // The actual authorization logic for Credentials will be added in auth.ts (Node.js)
    CredentialsProvider({}),
  ],
  callbacks: {
    // Basic JWT/Session callbacks that don't need the DB

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.image = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.image = (token.image as string) ?? null;
        session.user.name = (token.name as string) ?? null;
        session.user.hasPassword = token.hasPassword as boolean;
        session.user.isOAuth = token.isOAuth as boolean;
        session.user.currency = (token.currency as string) ?? "EUR";
        session.user.disciplinePenalty = (token.disciplinePenalty as number) ?? 0.5;
        session.user.companyName = (token.companyName as string | null) ?? null;
        session.user.whatsappUseCompany = (token.whatsappUseCompany as boolean) ?? false;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isDashboard = nextUrl.pathname.match(/^\/(en|es|zh)\/dashboard/);
      
      if (isDashboard && !isLoggedIn) {
        // Extract locale from the current path
        const pathnameParts = nextUrl.pathname.split('/');
        const potentialLocale = pathnameParts[1];
        const locale = ["en", "es", "zh"].includes(potentialLocale) ? potentialLocale : "en";
        
        // Construct localized login URL
        const loginUrl = new URL(`/${locale}/login`, nextUrl.origin);
        return Response.redirect(loginUrl);
      }
      
      return true;
    },
  },
} satisfies NextAuthConfig;


