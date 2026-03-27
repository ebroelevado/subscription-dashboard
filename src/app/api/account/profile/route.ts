import { type NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { updateProfileSchema } from "@/lib/validations/account";
import { success, withErrorHandling } from "@/lib/api-utils";

// PATCH /api/account/profile — Update display name / avatar
export async function PATCH(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const body = await request.json();
    const data = updateProfileSchema.parse(body);

    const [user] = await db.update(users).set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.image !== undefined && { image: data.image }),
    }).where(eq(users.id, userId)).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    });

    return success(user);
  });
}
