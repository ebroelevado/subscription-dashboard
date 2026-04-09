import { clearUserData } from "@/lib/services/account";
import { success, withErrorHandling } from "@/lib/api-utils";

// DELETE /api/account/clear-data — Delete all user business data but keep account
export async function DELETE() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    await clearUserData(userId);

    return success({ message: "Data cleared" });
  });
}
