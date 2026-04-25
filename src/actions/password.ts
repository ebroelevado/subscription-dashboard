"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { users, accounts } from "@/db/schema";

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
  })
  .refine(
    () => {
      // Current password is required if we're changing an existing one
      // We will check server-side if they actually have one.
      return true;
    },
    { message: "Current password is required" }
  );

export async function updatePasswordAction(
  prevState: unknown,
  formData: FormData
) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return { error: "Not authenticated", success: false };
    }

    const currentPassword = (formData.get("currentPassword") as string) || undefined;
    const newPassword = (formData.get("newPassword") as string) || "";

    const parsed = updatePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, success: false };
    }

    const dbUser = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { password: true },
      with: {
        accounts: {
          columns: { providerId: true },
        },
      },
    });

    if (!dbUser) {
      return { error: "User not found", success: false };
    }

    const hasPassword = !!dbUser.password;
    const isOAuth = dbUser.accounts.some((acc) => acc.providerId !== "credentials");

    if (hasPassword) {
      // State A: User has a password, verify current password
      if (!currentPassword) {
        return { error: "Current password is required", success: false };
      }
      
      const passwordMatch = await bcrypt.compare(currentPassword, dbUser.password!);
      if (!passwordMatch) {
        return { error: "Incorrect current password", success: false };
      }
    } else {
      // State B: User has no password (OAuth only)
      if (!isOAuth) {
        return { error: "Invalid account state", success: false };
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, session.user.id));

    return { success: true };
  } catch (error) {
    console.error("Failed to update password:", error);
    return { error: "Internal server error", success: false };
  }
}
