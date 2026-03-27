import { createAuthClient } from "better-auth/react";
import type { auth } from "./auth";

export const authClient = createAuthClient<typeof auth>({
  // Use relative URL for client-side - the browser will use the current origin
  baseURL: typeof window !== "undefined" ? window.location.origin : (process.env.AUTH_URL || "http://localhost:3000"),
});

export const { useSession, signIn, signUp, signOut } = authClient;
