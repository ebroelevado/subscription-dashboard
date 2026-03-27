import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Get the full session object (user + session data) using BetterAuth.
 * Returns null if not authenticated.
 * Use this in route handlers that need the full session.
 */
export async function getAuthSession() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    return session ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the authenticated user's ID from the session.
 * Returns the userId string if authenticated, or throws an error response.
 */
export async function getAuthUserId(): Promise<string> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    
    if (!session?.user?.id) {
      throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    return session.user.id;
  } catch (error) {
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
