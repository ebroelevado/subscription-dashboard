import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClientSchema } from "@/lib/validations";
import { success, error, withErrorHandling } from "@/lib/api-utils";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/clients/[id] — Client profile with all services and renewal history
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id, userId },
      include: {
        clientSubscriptions: {
          include: {
            subscription: {
              include: {
                plan: {
                  include: {
                    platform: { select: { id: true, name: true } },
                  },
                },
              },
            },
            renewalLogs: {
              orderBy: { paidOn: "desc" },
              take: 10,
            },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
    });

    if (!client) return error("Client not found", 404);

    const c = client as any;
    let score: number | null = null;
    if (c.disciplineScore !== null && c.disciplineScore !== undefined) {
        score = Number(c.disciplineScore);
        if (isNaN(score)) score = null;
    }

    const remapped = {
        id: c.id,
        name: c.name,
        phone: c.phone || "",
        notes: c.notes || "",
        createdAt: c.createdAt,
        disciplineScore: score,
        daysOverdue: Number(c.daysOverdue || 0),
        healthStatus: c.healthStatus || "New",
        clientSubscriptions: (c.clientSubscriptions || []).map((cs: any) => ({
            id: cs.id,
            status: cs.status,
            customPrice: Number(cs.customPrice || 0),
            joinedAt: cs.joinedAt,
            leftAt: cs.leftAt,
            activeUntil: cs.activeUntil,
            subscription: cs.subscription ? {
                id: cs.subscription.id,
                label: cs.subscription.label,
                status: cs.subscription.status,
                plan: cs.subscription.plan ? {
                    id: cs.subscription.plan.id,
                    name: cs.subscription.plan.name,
                    platform: {
                        id: cs.subscription.plan.platform?.id,
                        name: cs.subscription.plan.platform?.name || "Unknown"
                    }
                } : null
            } : null,
            renewalLogs: (cs.renewalLogs || []).map((rl: any) => ({
                id: rl.id,
                amountPaid: Number(rl.amountPaid),
                periodStart: rl.periodStart,
                periodEnd: rl.periodEnd,
                paidOn: rl.paidOn
            }))
        }))
    };

    return success(remapped);
  });
}

// PATCH /api/clients/[id]
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const body = await request.json();
    const data = createClientSchema.partial().parse(body);

    const updatedClient = await prisma.client.update({
      where: { id, userId },
      data,
    });

    const c = updatedClient as any;
    const remapped = {
        id: c.id,
        name: c.name,
        phone: c.phone || "",
        notes: c.notes || "",
        createdAt: c.createdAt,
        disciplineScore: c.disciplineScore ? Number(c.disciplineScore) : null,
        daysOverdue: Number(c.daysOverdue || 0),
        healthStatus: c.healthStatus || "New",
    };

    return success(remapped);
  });
}

// DELETE /api/clients/[id]
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    await prisma.client.delete({ where: { id, userId } });
    return success({ deleted: true });
  });
}
