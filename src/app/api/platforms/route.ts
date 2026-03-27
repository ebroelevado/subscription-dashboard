import { type NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { platforms, plans } from "@/db/schema";
import { createPlatformSchema } from "@/lib/validations";
import { success, withErrorHandling, error } from "@/lib/api-utils";

// GET /api/platforms — List all platforms for the authenticated user
export async function GET() {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const platformsList = await db.query.platforms.findMany({
      where: eq(platforms.userId, userId),
      orderBy: [asc(platforms.name)],
      with: {
        plans: {
          columns: { id: true, name: true, cost: true, maxSeats: true, isActive: true },
        },
      },
    });
    return success(platformsList);
  });
}


// POST /api/platforms — Create a new platform for the authenticated user
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const body = await request.json();
    const data = createPlatformSchema.parse(body);

    const { checkUserLimits } = await import("@/lib/saas-limits");
    const limitCheck = await checkUserLimits(userId);
    if (!limitCheck.canCreate && limitCheck.type === "PLATFORMS") {
      return error(limitCheck.message, 403);
    }

    const [platform] = await db.insert(platforms).values({ ...data, userId }).returning();
    return success(platform, 201);
  });
}

