import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, accounts } from "@/db/schema";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = signupSchema.parse(body);
    const hashedPassword = await bcrypt.hash(password, 10);

    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      const existingCredentialAccount = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.userId, existingUser.id),
          eq(accounts.providerId, "credential")
        ),
      });

      // Auto-repair legacy partial signups where user exists without credential account.
      if (!existingCredentialAccount) {
        const passwordToStore = existingUser.password ?? hashedPassword;

        await db.insert(accounts).values({
          userId: existingUser.id,
          accountId: existingUser.id,
          providerId: "credential",
          password: passwordToStore,
        });

        if (!existingUser.password) {
          await db
            .update(users)
            .set({ password: passwordToStore })
            .where(eq(users.id, existingUser.id));
        }

        return NextResponse.json({
          ok: true,
          repaired: true,
          user: {
            id: existingUser.id,
            email: existingUser.email,
            name: existingUser.name,
          },
        });
      }

      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    // Generate IDs explicitly so we don't depend on driver-specific RETURNING behavior.
    const userId = crypto.randomUUID();

    // Create the user
    await db.insert(users).values({
      id: userId,
      email,
      password: hashedPassword,
      name,
    });

    // Create credential account for better-auth
    await db.insert(accounts).values({
      userId,
      // Better Auth uses the user id as credential accountId in sign-up flow.
      accountId: userId,
      providerId: "credential",
      password: hashedPassword,
    });

    return NextResponse.json({
      ok: true,
      user: { id: userId, email, name },
    });
  } catch (error) {
    console.error("Signup error details:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
}
