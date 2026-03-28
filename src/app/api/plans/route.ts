import { type NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { plans, platforms } from "@/db/schema";
import { createPlanSchema } from "@/lib/validations";
import { success, withErrorHandling, error } from "@/lib/api-utils";
import { amountToCents } from "@/lib/currency";
import { checkPlanLimit } from "@/lib/saas-limits";

// GET /api/plans — List all plans for the authenticated user (optionally filtered by platformId)
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    
    const { searchParams } = new URL(request.url);
    const platformId = searchParams.get("platformId");

    const plansList = await db.query.plans.findMany({
      where: and(
        eq(plans.userId, userId),
        platformId ? eq(plans.platformId, platformId) : undefined
      ),
      orderBy: [desc(plans.createdAt)],
      with: { platform: { columns: { id: true, name: true } } },
    });
    return success(plansList);
  });
}

// POST /api/plans — Create a new plan for the authenticated user
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    
    const body = await request.json();
    const data = createPlanSchema.parse(body);

    const platform = await db.query.platforms.findFirst({
      where: and(eq(platforms.id, data.platformId), eq(platforms.userId, userId)),
      columns: { id: true },
    });

    if (!platform) {
      return error("Platform not found", 404);
    }

    const limitCheck = await checkPlanLimit(userId, data.platformId);
    if (!limitCheck.canCreate) {
      return error("Plan limit reached", 403);
    }

    const [plan] = await db.insert(plans).values({
      userId,
      platformId: data.platformId,
      name: data.name,
      cost: amountToCents(data.cost),
      maxSeats: data.maxSeats ?? null,
      isActive: data.isActive,
    }).returning();
    return success(plan, 201);
  });
}
