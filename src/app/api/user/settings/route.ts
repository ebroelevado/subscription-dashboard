import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { currency } = await req.json();

  const data: Record<string, unknown> = {};

  if (currency) {
    if (!['EUR', 'USD', 'GBP', 'CNY'].includes(currency)) {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }
    data.currency = currency;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const [user] = await db.update(users).set(data).where(eq(users.id, session.user.id)).returning();

    return NextResponse.json({ 
      ok: true, 
      data: {
        success: true, 
        currency: user.currency,
      }
    });
  } catch (error) {
    console.error("Settings update error:", error);
    return NextResponse.json({ 
      ok: false, 
      error: "Failed to update settings" 
    }, { status: 500 });
  }
}
