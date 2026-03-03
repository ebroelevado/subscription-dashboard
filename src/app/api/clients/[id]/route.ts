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
    return success(client);
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

    const client = await prisma.client.update({
      where: { id, userId },
      data,
    });
    return success(client);
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
