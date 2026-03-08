import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "./auth.config";

const nextAuth = NextAuth({
  ...authConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  providers: [
    ...authConfig.providers.filter((p) => p.id !== "credentials"),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.password) return null;

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!passwordMatch) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, account, session }) {
      if (user) {
        token.id = user.id;
        token.image = user.image;
        if (account?.provider === "google") {
          token.isOAuth = true;
        }
      }
      
      // Handle frontend session updates (e.g. update({ disciplinePenalty: 1.2 }))
      if (trigger === "update" && session) {
        if (session.name !== undefined) token.name = session.name;
        if (session.image !== undefined) token.image = session.image;
        if (session.currency !== undefined) token.currency = session.currency;
        if (session.disciplinePenalty !== undefined) token.disciplinePenalty = session.disciplinePenalty;
      }
      
      // Always fetch the latest critical settings from DB if we have the user ID.
      // NextAuth tokens are stateless and can become out of sync easily if the DB is modified 
      // via raw API routes or other devices.
      if (token.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { name: true, image: true, password: true, accounts: { select: { provider: true } }, currency: true, disciplinePenalty: true },
          });
          
          if (dbUser) {
            token.name = dbUser.name;
            token.image = dbUser.image;
            token.hasPassword = !!dbUser.password;
            token.isOAuth = dbUser.accounts?.some((acc: { provider: string }) => acc.provider !== "credentials") || false;
            token.currency = dbUser.currency || "EUR";
            token.disciplinePenalty = dbUser.disciplinePenalty ?? 0.5;
          }
        } catch (e) {
          console.error("[Auth] Error reading user from DB:", e);
        }
      }
      return token;
    },
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;
