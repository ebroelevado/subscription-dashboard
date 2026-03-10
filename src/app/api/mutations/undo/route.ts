/**
 * POST /api/mutations/undo
 *
 * Direct undo endpoint — bypasses the AI entirely.
 * The frontend calls this when the user clicks "Ir Atrás" on an executed mutation.
 *
 * Body: { auditLogId: string }
 * Loads the audit log, verifies ownership, restores previousValues in a $transaction,
 * and creates a new audit entry with action="undo".
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markAuditLogUndone } from "@/lib/mutation-token";
import { randomBytes } from "crypto";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { auditLogId } = await req.json();
    if (!auditLogId || typeof auditLogId !== "string") {
      return Response.json({ error: "Missing auditLogId" }, { status: 400 });
    }

    // Load the audit log entry
    const auditLog = await prisma.mutationAuditLog.findUnique({
      where: { id: auditLogId },
    });

    if (!auditLog) {
      return Response.json({ error: "Audit log not found." }, { status: 404 });
    }
    if (auditLog.userId !== userId) {
      return Response.json({ error: "Access denied." }, { status: 403 });
    }
    if (auditLog.undone) {
      return Response.json({ error: "This action was already undone." }, { status: 400 });
    }
    if (!auditLog.executedAt) {
      return Response.json({ error: "This action was never executed." }, { status: 400 });
    }

    const previousValues = (auditLog.previousValues as Record<string, unknown>) ?? {};
    const toolName = auditLog.toolName;
    const targetId = auditLog.targetId;

    // Execute the undo inside a transaction
    await undoMutation(userId, toolName, targetId, previousValues, auditLog.action);

    // Mark the original audit log as undone
    await markAuditLogUndone(auditLogId);

    // Create a new audit log entry for the undo action
    await prisma.mutationAuditLog.create({
      data: {
        userId,
        toolName,
        targetId,
        action: "undo",
        previousValues: (auditLog.newValues ?? undefined) as any, // What it was BEFORE undo (the executed state)
        newValues: (previousValues ?? undefined) as any, // What it is AFTER undo (the original state)
        token: randomBytes(32).toString("hex"), // Unique token for audit trail
        expiresAt: new Date(), // Already expired — this is a record, not a pending action
        executedAt: new Date(),
      },
    });

    return Response.json({ success: true, message: "Action undone successfully." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error undoing mutation";
    console.error("[Mutations/Undo]", message);
    return Response.json({ error: message }, { status: 400 });
  }
}

/**
 * Restores previousValues inside a $transaction based on tool type.
 */
async function undoMutation(
  userId: string,
  toolName: string,
  targetId: string | null,
  previousValues: Record<string, unknown>,
  action: string,
) {
  switch (toolName) {
    case "updateClient": {
      if (!targetId) throw new Error("Missing targetId");
      const client = await prisma.client.findFirst({ where: { id: targetId, userId } });
      if (!client) throw new Error("Client not found or unauthorized.");

      await prisma.$transaction(async (tx) => {
        await tx.client.update({
          where: { id: targetId },
          data: {
            name: previousValues.name as string,
            phone: (previousValues.phone as string) ?? null,
            notes: (previousValues.notes as string) ?? null,
          },
        });
      });
      break;
    }

    case "createClient": {
      // Undoing a creation = delete
      if (!targetId) throw new Error("Missing targetId");
      const client = await prisma.client.findFirst({ where: { id: targetId, userId } });
      if (!client) throw new Error("Client not found.");

      await prisma.$transaction(async (tx) => {
        await tx.client.delete({ where: { id: targetId } });
      });
      break;
    }

    case "updateUserConfig": {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: previousValues,
        });
      });
      break;
    }

    case "assignClientToSubscription": {
      // Undoing an assignment = delete the pivot row
      if (!targetId) throw new Error("Missing targetId");
      const cs = await prisma.clientSubscription.findFirst({
        where: { id: targetId, client: { userId } },
      });
      if (!cs) throw new Error("Assignment not found.");

      await prisma.$transaction(async (tx) => {
        await tx.clientSubscription.delete({ where: { id: targetId } });
      });
      break;
    }

    case "logPayment": {
      // Undoing a payment = delete the log + restore activeUntil
      if (!targetId) throw new Error("Missing targetId");
      const log = await prisma.renewalLog.findFirst({
        where: { id: targetId, clientSubscription: { subscription: { userId } } },
        include: { clientSubscription: true },
      });
      if (!log) throw new Error("Payment log not found.");

      await prisma.$transaction(async (tx) => {
        if (log.clientSubscriptionId) {
          await tx.clientSubscription.update({
            where: { id: log.clientSubscriptionId },
            data: { activeUntil: log.dueOn }, // Restore the original expiry
          });
        }
        await tx.renewalLog.delete({ where: { id: targetId! } });
      });
      break;
    }

    case "removeClientsFromSubscription": {
      const items = previousValues as any;
      if (!items || !items.length) break;
      await prisma.$transaction(async (tx) => {
        await tx.clientSubscription.createMany({
          data: items.map((previousValue: any) => ({
            id: previousValue.id as string,
            clientId: previousValue.clientId as string,
            subscriptionId: previousValue.subscriptionId as string,
            customPrice: previousValue.customPrice as any,
            activeUntil: new Date(previousValue.activeUntil as string),
            joinedAt: new Date(previousValue.joinedAt as string),
            leftAt: previousValue.leftAt ? new Date(previousValue.leftAt as string) : null,
            status: previousValue.status as any,
            remainingDays: previousValue.remainingDays as number | null,
            serviceUser: previousValue.serviceUser as string | null,
            servicePassword: previousValue.servicePassword as string | null,
          })),
        });
        // Reconnect renewal logs whose clientSubscriptionId was set to NULL on cascade
        for (const previousValue of items) {
          if (previousValue.renewalLogs?.length) {
            const logIds = (previousValue.renewalLogs as any[]).map((rl: any) => rl.id as string);
            await tx.renewalLog.updateMany({
              where: { id: { in: logIds } },
              data: { clientSubscriptionId: previousValue.id as string },
            });
          }
        }
      });
      break;
    }

    case "deleteClients": {
      const items = previousValues as any;
      if (!items || !items.length) break;
      await prisma.$transaction(async (tx) => {
        await tx.client.createMany({
          data: items.map((previousValue: any) => ({
            id: previousValue.id as string,
            userId,
            name: previousValue.name as string,
            phone: previousValue.phone as string | null,
            notes: previousValue.notes as string | null,
            createdAt: new Date(previousValue.createdAt as string),
            disciplineScore: previousValue.disciplineScore as any,
            dailyPenalty: previousValue.dailyPenalty as any,
            daysOverdue: previousValue.daysOverdue as number,
            healthStatus: previousValue.healthStatus as string | null,
          })),
        });
      });
      break;
    }

    case "managePlatforms": {
      if (action === "delete") {
         await prisma.platform.createMany({ data: previousValues as any });
      } else if (action === "update") {
         const items = previousValues as any;
         if (items && items[0]) await prisma.platform.update({ where: { id: items[0].id }, data: items[0] });
      }
      break;
    }

    case "managePlans": {
      if (action === "delete") {
         await prisma.plan.createMany({ data: previousValues as any });
      } else if (action === "update") {
         const items = previousValues as any;
         if (items && items[0]) await prisma.plan.update({ where: { id: items[0].id }, data: items[0] });
      }
      break;
    }

    case "manageSubscriptions": {
      if (action === "delete") {
        const items = previousValues as any;
        if (!items || !items.length) break;
        await prisma.$transaction(async (tx) => {
          for (const sub of items) {
            await tx.subscription.create({
              data: {
                id: sub.id as string,
                userId: sub.userId as string,
                planId: sub.planId as string,
                label: sub.label as string,
                startDate: new Date(sub.startDate as string),
                activeUntil: new Date(sub.activeUntil as string),
                status: sub.status as any,
                isAutopayable: sub.isAutopayable as boolean,
                createdAt: new Date(sub.createdAt as string),
                masterUsername: (sub.masterUsername as string | null) ?? null,
                masterPassword: (sub.masterPassword as string | null) ?? null,
                defaultPaymentNote: (sub.defaultPaymentNote as string | null) ?? null,
                ownerId: (sub.ownerId as string | null) ?? null,
              },
            });
            if (sub.clientSubscriptions?.length) {
              await tx.clientSubscription.createMany({
                data: (sub.clientSubscriptions as any[]).map((cs: any) => ({
                  id: cs.id as string,
                  clientId: cs.clientId as string,
                  subscriptionId: cs.subscriptionId as string,
                  customPrice: cs.customPrice as any,
                  activeUntil: new Date(cs.activeUntil as string),
                  joinedAt: new Date(cs.joinedAt as string),
                  leftAt: cs.leftAt ? new Date(cs.leftAt as string) : null,
                  status: cs.status as any,
                  remainingDays: (cs.remainingDays as number | null) ?? null,
                  serviceUser: (cs.serviceUser as string | null) ?? null,
                  servicePassword: (cs.servicePassword as string | null) ?? null,
                })),
              });
              for (const cs of sub.clientSubscriptions as any[]) {
                if (cs.renewalLogs?.length) {
                  const csLogIds = (cs.renewalLogs as any[]).map((rl: any) => rl.id as string);
                  await tx.renewalLog.updateMany({
                    where: { id: { in: csLogIds } },
                    data: { clientSubscriptionId: cs.id as string },
                  });
                }
              }
            }
            if (sub.platformRenewals?.length) {
              await tx.platformRenewal.createMany({
                data: (sub.platformRenewals as any[]).map((pr: any) => ({
                  id: pr.id as string,
                  subscriptionId: pr.subscriptionId as string,
                  amountPaid: pr.amountPaid as any,
                  periodStart: new Date(pr.periodStart as string),
                  periodEnd: new Date(pr.periodEnd as string),
                  paidOn: new Date(pr.paidOn as string),
                  notes: (pr.notes as string | null) ?? null,
                  createdAt: new Date(pr.createdAt as string),
                })),
              });
            }
          }
        });
      } else if (action === "update") {
         const items = previousValues as any;
         if (items && items[0]) await prisma.subscription.update({ where: { id: items[0].id }, data: items[0] });
      }
      break;
    }

    default:
      throw new Error(`Unknown tool for undo: ${toolName}`);
  }
}
