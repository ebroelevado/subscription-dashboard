import { type NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { clients, clientSubscriptions, subscriptions, plans, platforms } from "@/db/schema";
import { createClientSchema } from "@/lib/validations";
import { success, withErrorHandling } from "@/lib/api-utils";

// GET /api/clients — List all clients for the authenticated user
export async function GET() {
  return withErrorHandling(async () => {
    const authUtils = await import("@/lib/auth-utils");
    const userId = await authUtils.getAuthUserId();

    const clientsList = await db.query.clients.findMany({
      where: eq(clients.userId, userId),
      orderBy: [asc(clients.name)],
      with: {
          clientSubscriptions: {
              columns: {
                  id: true,
                  status: true,
                  customPrice: true,
                  activeUntil: true,
              },
              with: {
                  subscription: {
                      columns: {
                          id: true,
                          label: true,
                          status: true,
                          activeUntil: true,
                      },
                      with: {
                          plan: {
                              columns: { name: true },
                              with: {
                                  platform: { columns: { name: true } },
                              },
                          },
                      },
                  },
              },
          },
      },
    });

    // Standardize everything to be JSON-serializable numbers/strings
    const remapped = clientsList.map(client => {
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
          activeUntil: cs.activeUntil || cs.subscription?.activeUntil || client.createdAt,
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

    const { checkUserLimits } = await import("@/lib/saas-limits");
    const limitCheck = await checkUserLimits(userId);
    if (!limitCheck.canCreate) {
      throw new Error("Client limit reached");
    }

    const [newClient] = await db.insert(clients).values({
      userId,
      name: data.name,
      phone: data.phone ?? null,
      notes: data.notes ?? null,
    }).returning();

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
