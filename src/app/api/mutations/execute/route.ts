/**
 * POST /api/mutations/execute
 *
 * Direct execution endpoint — bypasses the AI entirely.
 * The frontend calls this when the user clicks "Accept" on a proposed mutation.
 *
 * Body: { token: string }
 * The token is validated, the stored payload is extracted, and the mutation
 * is applied inside a Prisma $transaction.
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  validateAndConsumeMutationToken,
  setAuditLogNewValues,
} from "@/lib/mutation-token";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return Response.json({ error: "Missing token" }, { status: 400 });
    }

    // Validate + consume the token (throws on failure)
    const auditLog = await validateAndConsumeMutationToken(token, userId);

    // Reconstruct the stored payload
    const previousValues = (auditLog.previousValues as Record<string, unknown>) ?? {};
    const toolName = auditLog.toolName;
    const targetId = auditLog.targetId;
    const action = auditLog.action as "create" | "update" | "delete";

    // Execute inside a transaction for atomicity
    const result = await executeMutation(userId, toolName, targetId, action, previousValues, auditLog.id);

    return Response.json({
      success: true,
      auditLogId: auditLog.id,
      result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error executing mutation";
    console.error("[Mutations/Execute]", message);
    return Response.json({ error: message }, { status: 400 });
  }
}

/**
 * Executes the actual database mutation inside a $transaction.
 * Each tool type has its own execution logic.
 */
async function executeMutation(
  userId: string,
  toolName: string,
  targetId: string | null,
  action: "create" | "update" | "delete",
  previousValues: Record<string, unknown>,
  auditLogId: string,
) {
  // Fetch the pending audit log to get the full payload stored in newValues
  // (We store the "changes to apply" temporarily in newValues during proposal,
  //  but newValues are replaced with actual post-execution values after.)
  // 
  // Actually — the changes are stored in the audit log's previousValues field
  // for "what was before" and we need the payload from the proposal.
  // We'll read from a separate store: the tool output stored the pendingChanges
  // in the audit log row. Let's use a pattern where:
  //   - previousValues = snapshot of old data
  //   - We re-read the auditLog to see what to apply.
  //
  // For maximum safety, we store the full execution payload as newValues=null
  // during proposal, and use a dedicated JSON field. But since we already have
  // the schema, let's store the pending changes in `newValues` during proposal,
  // and overwrite with actual result after execution.

  const auditLog = await prisma.mutationAuditLog.findUnique({
    where: { id: auditLogId },
  });
  if (!auditLog) throw new Error("Audit log not found");

  // The pending changes were stored in newValues during token creation
  const pendingChanges = (auditLog.newValues as Record<string, unknown>) ?? {};

  switch (toolName) {
    case "updateClient": {
      if (!targetId) throw new Error("Missing targetId for updateClient");
      const client = await prisma.client.findFirst({ where: { id: targetId, userId } });
      if (!client) throw new Error("Client not found or access denied.");

      const updated = await prisma.$transaction(async (tx) => {
        return tx.client.update({
          where: { id: targetId },
          data: {
            ...(pendingChanges.name ? { name: pendingChanges.name as string } : {}),
            ...(pendingChanges.phone ? { phone: pendingChanges.phone as string } : {}),
            ...(pendingChanges.notes !== undefined ? { notes: pendingChanges.notes as string } : {}),
          },
        });
      });

      await setAuditLogNewValues(auditLogId, {
        name: updated.name,
        phone: updated.phone,
        notes: updated.notes,
      });

      return { message: `Client ${updated.name} updated.`, client: updated };
    }

    case "createClient": {
      const created = await prisma.$transaction(async (tx) => {
        return tx.client.create({
          data: {
            userId,
            name: (pendingChanges.name as string) || "Unnamed",
            phone: (pendingChanges.phone as string) || undefined,
            notes: (pendingChanges.notes as string) || undefined,
          },
        });
      });

      // Update the audit log with the real targetId (we now know the created ID)
      await prisma.mutationAuditLog.update({
        where: { id: auditLogId },
        data: { targetId: created.id },
      });
      await setAuditLogNewValues(auditLogId, { id: created.id, name: created.name });

      return { message: `Client ${created.name} created.`, client: created };
    }

    case "updateUserConfig": {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("User not found.");

      const updated = await prisma.$transaction(async (tx) => {
        return tx.user.update({
          where: { id: userId },
          data: {
            ...(pendingChanges.disciplinePenalty !== undefined
              ? { disciplinePenalty: pendingChanges.disciplinePenalty as number }
              : {}),
            ...(pendingChanges.currency
              ? { currency: pendingChanges.currency as string }
              : {}),
          },
          select: { disciplinePenalty: true, currency: true },
        });
      });

      await setAuditLogNewValues(auditLogId, updated);

      return { message: "Configuration updated.", config: updated };
    }

    case "assignClientToSubscription": {
      const clientId = pendingChanges.clientId as string;
      const subscriptionId = pendingChanges.subscriptionId as string;
      if (!clientId || !subscriptionId) throw new Error("Missing clientId or subscriptionId");

      const client = await prisma.client.findFirst({ where: { id: clientId, userId } });
      const sub = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
      if (!client || !sub) throw new Error("Client or Subscription not found.");

      const cs = await prisma.$transaction(async (tx) => {
        return tx.clientSubscription.create({
          data: {
            clientId,
            subscriptionId,
            customPrice: pendingChanges.customPrice as number,
            activeUntil: new Date(pendingChanges.activeUntil as string),
            joinedAt: pendingChanges.joinedAt
              ? new Date(pendingChanges.joinedAt as string)
              : new Date(),
            serviceUser: (pendingChanges.serviceUser as string) || undefined,
            servicePassword: (pendingChanges.servicePassword as string) || undefined,
            status: "active",
          },
        });
      });

      await prisma.mutationAuditLog.update({
        where: { id: auditLogId },
        data: { targetId: cs.id },
      });
      await setAuditLogNewValues(auditLogId, { id: cs.id, clientId, subscriptionId });

      return { message: `Assigned ${client.name} to ${sub.label}.`, clientSubscription: cs };
    }

    case "logPayment": {
      const csId = pendingChanges.clientSubscriptionId as string;
      if (!csId) throw new Error("Missing clientSubscriptionId");

      const cs = await prisma.clientSubscription.findFirst({
        where: { id: csId, subscription: { userId } },
        include: { client: true },
      });
      if (!cs) throw new Error("Client subscription not found.");

      const monthsRenewed = (pendingChanges.monthsRenewed as number) || 1;
      const startDate = cs.activeUntil > new Date() ? cs.activeUntil : new Date();
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + monthsRenewed);

      const log = await prisma.$transaction(async (tx) => {
        const renewalLog = await tx.renewalLog.create({
          data: {
            clientSubscriptionId: csId,
            amountPaid: pendingChanges.amountPaid as number,
            expectedAmount: cs.customPrice,
            periodStart: startDate,
            periodEnd: endDate,
            paidOn: pendingChanges.paidOn
              ? new Date(pendingChanges.paidOn as string)
              : new Date(),
            dueOn: cs.activeUntil,
            monthsRenewed,
            notes: (pendingChanges.notes as string) || undefined,
          },
        });

        await tx.clientSubscription.update({
          where: { id: csId },
          data: { activeUntil: endDate },
        });

        return renewalLog;
      });

      await prisma.mutationAuditLog.update({
        where: { id: auditLogId },
        data: { targetId: log.id },
      });
      await setAuditLogNewValues(auditLogId, {
        id: log.id,
        activeUntil: endDate.toISOString(),
      });

      return {
        message: `Payment of ${pendingChanges.amountPaid}€ logged for ${cs.client.name}.`,
        log,
      };
    }

    case "removeClientsFromSubscription": {
      const ids = pendingChanges.clientSubscriptionIds as string[];
      if (!ids || !ids.length) throw new Error("Missing clientSubscriptionIds");

      await prisma.$transaction(async (tx) => {
        // Must ensure they belong to this user
        // Due to prisma's limited nested deleteMany, we do it safely:
        const toDelete = await tx.clientSubscription.findMany({
          where: { id: { in: ids }, client: { userId } },
          select: { id: true },
        });
        const validIds = toDelete.map((c) => c.id);
        if (validIds.length > 0) {
          await tx.clientSubscription.deleteMany({ where: { id: { in: validIds } } });
        }
      });

      await prisma.mutationAuditLog.update({
        where: { id: auditLogId },
        data: { targetId: "bulk" },
      });

      await setAuditLogNewValues(auditLogId, { ids });

      return { message: `Removed ${ids.length} seat assignment(s).` };
    }

    case "deleteClients": {
      const clientIds = pendingChanges.clientIds as string[];
      if (!clientIds || !clientIds.length) throw new Error("Missing clientIds");

      await prisma.$transaction(async (tx) => {
        await tx.client.deleteMany({ where: { id: { in: clientIds }, userId } });
      });

      await prisma.mutationAuditLog.update({
        where: { id: auditLogId },
        data: { targetId: "bulk" },
      });

      await setAuditLogNewValues(auditLogId, { clientIds });
      return { message: `${clientIds.length} client(s) deleted successfully.` };
    }

    case "managePlatforms": {
      const { operation, platformIds, name, icon } = pendingChanges;
      const result = await prisma.$transaction(async (tx) => {
         if (operation === "delete") {
            const result = await tx.platform.deleteMany({ where: { id: { in: platformIds as string[] }, userId } });
            return { deletedCount: result.count };
         } else if (operation === "update") {
            return tx.platform.update({ where: { id: (platformIds as string[])[0], userId }, data: { name: name as string }});
         } else if (operation === "create") {
            return tx.platform.create({ data: { userId, name: name as string }});
         }
         return null;
      });
      await setAuditLogNewValues(auditLogId, { result });
      return { message: `Platform(s) ${operation}d.`, result };
    }

    case "managePlans": {
      const { operation, planIds, platformId, name, cost, maxSeats, isActive } = pendingChanges;
      const result = await prisma.$transaction(async (tx) => {
         if (operation === "delete") {
            return tx.plan.deleteMany({ where: { id: { in: planIds as string[] }, platform: { userId } } });
         } else if (operation === "update") {
            return tx.plan.update({ 
               where: { id: (planIds as string[])[0], platform: { userId } }, 
               data: { name: name as string, cost: cost as number, maxSeats: maxSeats as number, isActive: isActive as boolean }
            });
         } else if (operation === "create") {
            return tx.plan.create({ data: { userId, platformId: platformId as string, name: name as string, cost: cost as number, maxSeats: maxSeats as number, isActive: isActive as boolean ?? true }});
         }
         return null;
      });
      await setAuditLogNewValues(auditLogId, { result });
      return { message: `Plan(s) ${operation}d.`, result };
    }

    case "manageSubscriptions": {
      const { operation, subscriptionIds, planId, label, status, startDate, activeUntil, masterUsername, masterPassword } = pendingChanges;
      const result = await prisma.$transaction(async (tx) => {
         if (operation === "delete") {
            return tx.subscription.deleteMany({ where: { id: { in: subscriptionIds as string[] }, userId } });
         } else if (operation === "update") {
            return tx.subscription.update({ 
               where: { id: (subscriptionIds as string[])[0], userId }, 
               data: { 
                 label: label as string, status: (status as "active" | "paused") ?? undefined, masterUsername: masterUsername as string, masterPassword: masterPassword as string,
                 ...(startDate ? { startDate: new Date(startDate as string) } : {}),
                 ...(activeUntil ? { activeUntil: new Date(activeUntil as string) } : {})
               }
            });
         } else if (operation === "create") {
            return tx.subscription.create({ data: { userId, planId: planId as string, label: label as string, status: (status as any) ?? "active", startDate: new Date(startDate as string), activeUntil: new Date(activeUntil as string), masterUsername: masterUsername as string, masterPassword: masterPassword as string }});
         }
         return null;
      });
      await setAuditLogNewValues(auditLogId, { result });
      return { message: `Subscription(s) ${operation}d.`, result };
    }

    case "managePayments": {
      const { operation, paymentId, amountPaid, paidOn, notes, periodStart, periodEnd } = pendingChanges;
      if (!paymentId) throw new Error("Missing paymentId");

      const payment = await prisma.renewalLog.findFirst({
        where: { id: paymentId as string, clientSubscription: { subscription: { userId } } },
        include: { clientSubscription: true },
      });
      if (!payment) throw new Error("Payment record not found or access denied.");

      if (operation === "delete") {
        await prisma.$transaction(async (tx) => {
          await tx.renewalLog.delete({ where: { id: paymentId as string } });

          // If this was the latest payment for this seat, revert activeUntil to periodStart
          if (payment.clientSubscriptionId) {
            const laterLogs = await tx.renewalLog.findMany({
              where: {
                clientSubscriptionId: payment.clientSubscriptionId,
                paidOn: { gte: payment.paidOn },
                id: { not: payment.id },
              },
              orderBy: { paidOn: "desc" },
              take: 1,
            });

            if (!laterLogs.length) {
              // No later payments — revert activeUntil back to what it was before this payment
              await tx.clientSubscription.update({
                where: { id: payment.clientSubscriptionId },
                data: { activeUntil: payment.periodStart },
              });
            }
          }
        });

        await setAuditLogNewValues(auditLogId, { deleted: true, paymentId });
        return { message: `Payment of €${Number(previousValues.amountPaid).toFixed(2)} deleted successfully.` };
      }

      // Update operation
      const updated = await prisma.$transaction(async (tx) => {
        return tx.renewalLog.update({
          where: { id: paymentId as string },
          data: {
            ...(amountPaid !== undefined ? { amountPaid: amountPaid as number } : {}),
            ...(paidOn ? { paidOn: new Date(paidOn as string) } : {}),
            ...(notes !== undefined ? { notes: notes as string } : {}),
            ...(periodStart ? { periodStart: new Date(periodStart as string) } : {}),
            ...(periodEnd ? { periodEnd: new Date(periodEnd as string) } : {}),
          },
        });
      });

      await setAuditLogNewValues(auditLogId, {
        amountPaid: Number(updated.amountPaid),
        paidOn: updated.paidOn.toISOString(),
        notes: updated.notes,
        periodStart: updated.periodStart.toISOString(),
        periodEnd: updated.periodEnd.toISOString(),
      });

      return { message: `Payment updated successfully. New amount: €${Number(updated.amountPaid).toFixed(2)}.`, payment: updated };
    }

    case "bulkManageSeats": {
      const { operation, clientSubscriptionIds } = pendingChanges;
      if (!clientSubscriptionIds || !Array.isArray(clientSubscriptionIds) || !clientSubscriptionIds.length) {
        throw new Error("Missing clientSubscriptionIds");
      }

      const targetStatus = operation === "pause" ? "paused" : "active";

      await prisma.$transaction(async (tx) => {
        // Validate ownership
        const toUpdate = await tx.clientSubscription.findMany({
          where: { id: { in: clientSubscriptionIds as string[] }, client: { userId } },
          select: { id: true },
        });
        const validIds = toUpdate.map((s) => s.id);
        if (validIds.length > 0) {
          await tx.clientSubscription.updateMany({
            where: { id: { in: validIds } },
            data: { status: targetStatus },
          });
        }
      });

      await setAuditLogNewValues(auditLogId, { status: targetStatus, count: (clientSubscriptionIds as string[]).length });
      return { message: `${(clientSubscriptionIds as string[]).length} seat(s) ${targetStatus === "paused" ? "paused" : "resumed"} successfully.` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
