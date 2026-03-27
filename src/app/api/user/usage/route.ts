import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { increment } = await req.json();
    if (typeof increment !== "number") {
      return NextResponse.json({ error: "Invalid increment value" }, { status: 400 });
    }

    const [updatedUser] = await db.update(users).set({
      usageCredits: sql`${users.usageCredits} + ${increment}`,
    }).where(eq(users.id, session.user.id)).returning({
      usageCredits: users.usageCredits,
    });

    return NextResponse.json({ usageCredits: updatedUser.usageCredits });
  } catch (error) {
    console.error("Error updating usage credits:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
