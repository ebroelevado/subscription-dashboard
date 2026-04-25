import { createAuthClient } from "better-auth/react";
import { customSessionClient } from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient<typeof auth>({
  // Use relative URL for client-side - the browser will use the current origin
  baseURL: typeof window !== "undefined" ? window.location.origin : (process.env.AUTH_URL || "http://localhost:3000"),
  // Avoid noisy /api/auth/get-session traffic during tab focus changes and transient failures.
  sessionOptions: {
    refetchInterval: 0,
    refetchOnWindowFocus: false,
    refetchWhenOffline: false,
  },
  fetchOptions: {
    retry: 0,
  },
  plugins: [customSessionClient<typeof auth>()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
