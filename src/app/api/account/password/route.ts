import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

const setPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export async function POST(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const result = setPasswordSchema.safeParse(body);
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { password } = result.data;
    const hashedPassword = await bcrypt.hash(password, 10);

    const [updatedUser] = await db.update(users).set({
      password: hashedPassword,
    }).where(eq(users.id, session.user.id)).returning({
      id: users.id,
      email: users.email,
      name: users.name,
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("[SET_PASSWORD_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
