import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPlanSchema } from "@/lib/validations";
import { success, withErrorHandling, error } from "@/lib/api-utils";
import { checkPlanLimit } from "@/lib/saas-limits";

// GET /api/plans — List all plans for the authenticated user (optionally filtered by platformId)
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    
    const { searchParams } = new URL(request.url);
    const platformId = searchParams.get("platformId");

    const plans = await prisma.plan.findMany({
      where: {
        userId,
        ...(platformId && { platformId }),
      },
      orderBy: { createdAt: "desc" },
      include: { platform: { select: { id: true, name: true } } },
    });
    return success(plans);
  });
}

// POST /api/plans — Create a new plan for the authenticated user
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    
    const body = await request.json();
    const data = createPlanSchema.parse(body);

    const platform = await prisma.platform.findUnique({
      where: { id: data.platformId, userId },
      select: { id: true },
    });

    if (!platform) {
      return error("Platform not found", 404);
    }

    const limitCheck = await checkPlanLimit(userId, data.platformId);
    if (!limitCheck.canCreate) {
      return error(limitCheck.message || "Plan limit reached", 403);
    }

    const plan = await prisma.plan.create({
      data: {
        userId,
        platformId: data.platformId,
        name: data.name,
        cost: data.cost,
        maxSeats: data.maxSeats ?? null,
        isActive: data.isActive,
      },
    });
    return success(plan, 201);
  });
}
