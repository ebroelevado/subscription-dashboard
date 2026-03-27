import { type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { platforms, plans, subscriptions } from "@/db/schema";
import { createPlatformSchema } from "@/lib/validations";
import { success, error, withErrorHandling } from "@/lib/api-utils";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/platforms/[id] — Get one platform with its plans
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;
    
    const platform = await db.query.platforms.findFirst({
      where: and(eq(platforms.id, id), eq(platforms.userId, userId)),
      with: {
        plans: {
          with: {
            subscriptions: {
              columns: {
                id: true,
                label: true,
                status: true,
                activeUntil: true,
              },
            },
          },
        },
      },
    });

    if (!platform) return error("Platform not found", 404);
    return success(platform);
  });
}

// PATCH /api/platforms/[id] — Update a platform
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;
    const body = await request.json();
    const data = createPlatformSchema.partial().parse(body);

    const [platform] = await db.update(platforms)
      .set(data)
      .where(and(eq(platforms.id, id), eq(platforms.userId, userId)))
      .returning();
    return success(platform);
  });
}

// DELETE /api/platforms/[id] — Delete a platform
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;
    
    await db.delete(platforms).where(and(eq(platforms.id, id), eq(platforms.userId, userId)));
    return success({ deleted: true });
  });
}
