import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClientSchema } from "@/lib/validations";
import { success, withErrorHandling } from "@/lib/api-utils";

// GET /api/clients — List all clients for the authenticated user
export async function GET() {
  return withErrorHandling(async () => {
    const authUtils = await import("@/lib/auth-utils");
    const userId = await authUtils.getAuthUserId();

    const clients = await prisma.client.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      select: {
          id: true,
          name: true,
          phone: true,
          notes: true,
          createdAt: true,
          clientSubscriptions: {
              select: {
                  id: true,
                  status: true,
                  customPrice: true,
                  activeUntil: true,
                  subscription: {
                      select: {
                          id: true,
                          label: true,
                          status: true,
                          activeUntil: true,
                          plan: {
                              select: {
                                  name: true,
                                  platform: { select: { name: true } },
                              },
                          },
                      },
                  },
              },
          },
      },
    });

    // Standardize everything to be JSON-serializable numbers/strings
    const remapped = clients.map(client => {
      return {
        id: client.id,
        name: client.name,
        phone: client.phone || "",
        notes: client.notes || "",
        createdAt: client.createdAt,
        clientSubscriptions: (client.clientSubscriptions || []).map((cs: any) => ({
          id: cs.id,
          status: cs.status,
          customPrice: Number(cs.customPrice || 0),
          activeUntil: cs.subscription?.activeUntil || client.createdAt,
          subscription: cs.subscription ? {
            id: cs.subscription.id,
            label: cs.subscription.label,
            status: cs.subscription.status,
            activeUntil: cs.subscription.activeUntil,
            plan: cs.subscription.plan ? {
              name: cs.subscription.plan.name,
              platform: {
                name: cs.subscription.plan.platform?.name || "Unknown"
              }
            } : null
          } : null
        }))
      };
    });

    return success(remapped);
  });
}

// POST /api/clients — Create a new client for the authenticated user
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    
    const body = await request.json();
    const data = createClientSchema.parse(body);

    const newClient = await prisma.client.create({
      data: {
        userId,
        name: data.name,
        phone: data.phone ?? null,
        notes: data.notes ?? null,
      },
    });

    const c = newClient as any;
    const remapped = {
        id: c.id,
        name: c.name,
        phone: c.phone || "",
        notes: c.notes || "",
        createdAt: c.createdAt,
        disciplineScore: null,
        daysOverdue: 0,
        healthStatus: "New",
    };

    return success(remapped, 201);
  });
}
