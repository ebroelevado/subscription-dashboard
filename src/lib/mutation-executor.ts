import { eq, and, desc, inArray, ne, gte, sql } from "drizzle-orm";
import {
  clients,
  clientSubscriptions,
  subscriptions,
  users,
  platforms,
  plans,
  renewalLogs,
  platformRenewals,
  mutationAuditLogs,
} from "@/db/schema";
import {
  setAuditLogNewValues,
} from "@/lib/mutation-token";
import { amountToCents } from "@/lib/currency";
import { encryptCredential } from "@/lib/credential-encryption";
import { Database } from "@/db";

function parseJsonField(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value);
  return value as Record<string, unknown>;
}

export async function runMutationInTransaction<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => fn(tx as unknown as Database));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const beginUnsupported =
      message.includes("Failed query: begin") ||
      message.includes("cannot start a transaction") ||
      message.includes("near \"begin\"");

    if (!beginUnsupported) {
      throw error;
    }

    // Some remote D1/proxy execution paths reject explicit BEGIN; fallback to direct writes.
    console.warn("[Mutation Executor] Transaction BEGIN unsupported in current DB path. Retrying without explicit transaction.");
    return await fn(db);
  }
}

/**
 * Executes the actual database mutation inside a transaction.
 * Each tool type has its own execution logic.
 */
export async function executeMutation(
  db: Database,
  userId: string,
  toolName: string,
  targetId: string | null,
  action: "create" | "update" | "delete",
  previousValues: Record<string, unknown>,
  auditLogId: string,
) {
  // Fetch the pending audit log to get the full payload stored in newValues
  const auditLog = await db.query.mutationAuditLogs.findFirst({
    where: eq(mutationAuditLogs.id, auditLogId),
  });
  if (!auditLog) throw new Error("Audit log not found");

  // The pending changes were stored in newValues during token creation
  const pendingChanges = parseJsonField(auditLog.newValues);

  switch (toolName) {
    case "updateClient": {
      if (!targetId) throw new Error("Missing targetId for updateClient");
      const client = await db.query.clients.findFirst({
        where: and(eq(clients.id, targetId), eq(clients.userId, userId)),
      });
      if (!client) throw new Error("Client not found or access denied.");

      const [updated] = await runMutationInTransaction(db, async (tx) => {
        return tx.update(clients).set({
          ...(pendingChanges.name ? { name: pendingChanges.name as string } : {}),
          ...(pendingChanges.phone ? { phone: pendingChanges.phone as string } : {}),
          ...(pendingChanges.notes !== undefined ? { notes: pendingChanges.notes as string } : {}),
        }).where(eq(clients.id, targetId)).returning();
      });

      await setAuditLogNewValues(auditLogId, {
        name: updated.name,
        phone: updated.phone,
        notes: updated.notes,
      });

      return { message: `Client ${updated.name} updated.`, client: updated };
    }

    case "createClient": {
      const [created] = await runMutationInTransaction(db, async (tx) => {
        return tx.insert(clients).values({
          userId,
          name: (pendingChanges.name as string) || "Unnamed",
          phone: (pendingChanges.phone as string) || null,
          notes: (pendingChanges.notes as string) || null,
        }).returning();
      });

      // Update the audit log with the real targetId (we now know the created ID)
      await db.update(mutationAuditLogs).set({ targetId: created.id }).where(eq(mutationAuditLogs.id, auditLogId));
      await setAuditLogNewValues(auditLogId, { id: created.id, name: created.name });

      return { message: `Client ${created.name} created.`, client: created };
    }

    case "updateUserConfig": {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) throw new Error("User not found.");

      const [updated] = await runMutationInTransaction(db, async (tx) => {
        return tx.update(users).set({
          ...(pendingChanges.disciplinePenalty !== undefined
            ? { disciplinePenalty: pendingChanges.disciplinePenalty as number }
            : {}),
          ...(pendingChanges.currency
            ? { currency: pendingChanges.currency as string }
            : {}),
          ...(pendingChanges.companyName !== undefined
            ? { companyName: pendingChanges.companyName as string }
            : {}),
          ...(pendingChanges.whatsappSignatureMode !== undefined
            ? { whatsappSignatureMode: pendingChanges.whatsappSignatureMode as string }
            : {}),
        }).where(eq(users.id, userId)).returning({
          disciplinePenalty: users.disciplinePenalty,
          currency: users.currency,
          companyName: users.companyName,
          whatsappSignatureMode: users.whatsappSignatureMode,
        });
      });

      await setAuditLogNewValues(auditLogId, updated);

      return { message: "Configuration updated.", config: updated };
    }

    case "assignClientToSubscription": {
      const clientId = pendingChanges.clientId as string;
      const subscriptionId = pendingChanges.subscriptionId as string;
      if (!clientId || !subscriptionId) throw new Error("Missing clientId or subscriptionId");

      const client = await db.query.clients.findFirst({
        where: and(eq(clients.id, clientId), eq(clients.userId, userId)),
      });
      const sub = await db.query.subscriptions.findFirst({
        where: and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)),
      });
      if (!client || !sub) throw new Error("Client or Subscription not found.");

      const activeUntilStr = typeof pendingChanges.activeUntil === "string"
        ? pendingChanges.activeUntil
        : new Date(pendingChanges.activeUntil as string).toISOString().split("T")[0];
      const joinedAtStr = pendingChanges.joinedAt
        ? (typeof pendingChanges.joinedAt === "string"
            ? pendingChanges.joinedAt
            : new Date(pendingChanges.joinedAt as string).toISOString().split("T")[0])
        : new Date().toISOString().split("T")[0];

      const [cs] = await runMutationInTransaction(db, async (tx) => {
        return tx.insert(clientSubscriptions).values({
          clientId,
          subscriptionId,
          customPrice: amountToCents(pendingChanges.customPrice as number),
          activeUntil: activeUntilStr,
          joinedAt: joinedAtStr,
          serviceUser: await encryptCredential((pendingChanges.serviceUser as string) || null) || null,
          servicePassword: await encryptCredential((pendingChanges.servicePassword as string) || null) || null,
          status: "active",
        }).returning();
      });

      await db.update(mutationAuditLogs).set({ targetId: cs.id }).where(eq(mutationAuditLogs.id, auditLogId));
      await setAuditLogNewValues(auditLogId, { id: cs.id, clientId, subscriptionId });

      return { message: `Assigned ${client.name} to ${sub.label}.`, clientSubscription: cs };
    }

    case "logPayment": {
      const csId = pendingChanges.clientSubscriptionId as string;
      if (!csId) throw new Error("Missing clientSubscriptionId");

      const cs = await db.query.clientSubscriptions.findFirst({
        where: eq(clientSubscriptions.id, csId),
        with: {
          client: true,
          subscription: { with: { plan: true } },
        },
      });
      if (!cs) throw new Error("Client subscription not found.");
      // Verify ownership through subscription
      const sub = await db.query.subscriptions.findFirst({
        where: and(eq(subscriptions.id, cs.subscriptionId), eq(subscriptions.userId, userId)),
      });
      if (!sub) throw new Error("Access denied.");

      const monthsRenewed = (pendingChanges.monthsRenewed as number) || 1;
      const csActiveUntil = new Date(cs.activeUntil);
      const now = new Date();
      const startDate = csActiveUntil > now ? csActiveUntil : now;
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + monthsRenewed);

      const startDateStr = startDate.toISOString().split("T")[0];
      const endDateStr = endDate.toISOString().split("T")[0];
      const paidOnStr = pendingChanges.paidOn
        ? (typeof pendingChanges.paidOn === "string" ? pendingChanges.paidOn : new Date(pendingChanges.paidOn as string).toISOString().split("T")[0])
        : new Date().toISOString().split("T")[0];
      const dueOnStr = cs.activeUntil;

      const [log] = await runMutationInTransaction(db, async (tx) => {
        const [renewalLog] = await tx.insert(renewalLogs).values({
          clientSubscriptionId: csId,
          amountPaid: amountToCents(pendingChanges.amountPaid as number),
          expectedAmount: cs.customPrice,
          periodStart: startDateStr,
          periodEnd: endDateStr,
          paidOn: paidOnStr,
          dueOn: dueOnStr,
          monthsRenewed,
          notes: (pendingChanges.notes as string) || null,
        }).returning();

        await tx.update(clientSubscriptions).set({ activeUntil: endDateStr }).where(eq(clientSubscriptions.id, csId));

        return [renewalLog];
      });

      await db.update(mutationAuditLogs).set({ targetId: log.id }).where(eq(mutationAuditLogs.id, auditLogId));
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

      await runMutationInTransaction(db, async (tx) => {
        // Must ensure they belong to this user
        const toDelete = await tx.query.clientSubscriptions.findMany({
          where: inArray(clientSubscriptions.id, ids),
          with: { client: { columns: { userId: true } } },
          columns: { id: true },
        });
        const validIds = toDelete.filter((c) => c.client.userId === userId).map((c) => c.id);
        if (validIds.length > 0) {
          await tx.delete(clientSubscriptions).where(inArray(clientSubscriptions.id, validIds));
        }
      });

      await db.update(mutationAuditLogs).set({ targetId: "bulk" }).where(eq(mutationAuditLogs.id, auditLogId));
      await setAuditLogNewValues(auditLogId, { ids });

      return { message: `Removed ${ids.length} seat assignment(s).` };
    }

    case "deleteClients": {
      const clientIds = pendingChanges.clientIds as string[];
      if (!clientIds || !clientIds.length) throw new Error("Missing clientIds");

      await runMutationInTransaction(db, async (tx) => {
        await tx.delete(clients).where(and(inArray(clients.id, clientIds), eq(clients.userId, userId)));
      });

      await db.update(mutationAuditLogs).set({ targetId: "bulk" }).where(eq(mutationAuditLogs.id, auditLogId));
      await setAuditLogNewValues(auditLogId, { clientIds });
      return { message: `${clientIds.length} client(s) deleted successfully.` };
    }

    case "managePlatforms": {
      const { operation, platformIds, name } = pendingChanges;
      let result: unknown = null;
      await runMutationInTransaction(db, async (tx) => {
        if (operation === "delete") {
          await tx.delete(platforms).where(and(inArray(platforms.id, platformIds as string[]), eq(platforms.userId, userId)));
          result = { deletedCount: (platformIds as string[]).length };
        } else if (operation === "update") {
          const [updated] = await tx.update(platforms).set({ name: name as string }).where(and(eq(platforms.id, (platformIds as string[])[0]), eq(platforms.userId, userId))).returning();
          result = updated;
        } else if (operation === "create") {
          const [created] = await tx.insert(platforms).values({ userId, name: name as string }).returning();
          result = created;
        }
      });
      await setAuditLogNewValues(auditLogId, { result });
      return { message: `Platform(s) ${operation}d.`, result };
    }

    case "managePlans": {
      const { operation, planIds, platformId, name, cost, maxSeats, isActive } = pendingChanges;
      let result: unknown = null;
      await runMutationInTransaction(db, async (tx) => {
        if (operation === "delete") {
          await tx.delete(plans).where(and(inArray(plans.id, planIds as string[]), eq(plans.userId, userId)));
          result = { deletedCount: (planIds as string[]).length };
          } else if (operation === "update") {
          const [updated] = await tx.update(plans).set({
            name: name as string,
            cost: amountToCents(cost as number),
            maxSeats: maxSeats as number,
            isActive: isActive as boolean,
          }).where(and(eq(plans.id, (planIds as string[])[0]), eq(plans.userId, userId))).returning();
          result = updated;
        } else if (operation === "create") {
          const [created] = await tx.insert(plans).values({
            userId,
            platformId: platformId as string,
            name: name as string,
            cost: amountToCents(cost as number),
            maxSeats: maxSeats as number,
            isActive: (isActive as boolean) ?? true,
          }).returning();
          result = created;
        }
      });
      await setAuditLogNewValues(auditLogId, { result });
      return { message: `Plan(s) ${operation}d.`, result };
    }

    case "manageSubscriptions": {
      const { operation, subscriptionIds, planId, label, status, startDate, activeUntil, masterUsername, masterPassword } = pendingChanges;
      let result: unknown = null;
      await runMutationInTransaction(db, async (tx) => {
        if (operation === "delete") {
          await tx.delete(subscriptions).where(and(inArray(subscriptions.id, subscriptionIds as string[]), eq(subscriptions.userId, userId)));
          result = { deletedCount: (subscriptionIds as string[]).length };
        } else if (operation === "update") {
          const startDateStr = startDate
            ? (typeof startDate === "string" ? startDate : new Date(startDate as string).toISOString().split("T")[0])
            : undefined;
          const activeUntilStr = activeUntil
            ? (typeof activeUntil === "string" ? activeUntil : new Date(activeUntil as string).toISOString().split("T")[0])
            : undefined;
          const [updated] = await tx.update(subscriptions).set({
            label: label as string,
            status: (status as "active" | "paused") ?? undefined,
            masterUsername: masterUsername as string ?? undefined,
            masterPassword: await encryptCredential((masterPassword as string) || null) ?? undefined,
            ...(startDateStr ? { startDate: startDateStr } : {}),
            ...(activeUntilStr ? { activeUntil: activeUntilStr } : {}),
          }).where(and(eq(subscriptions.id, (subscriptionIds as string[])[0]), eq(subscriptions.userId, userId))).returning();
          result = updated;
        } else if (operation === "create") {
          const startDateStr = typeof startDate === "string" ? startDate : new Date(startDate as string).toISOString().split("T")[0];
          const activeUntilStr = typeof activeUntil === "string" ? activeUntil : new Date(activeUntil as string).toISOString().split("T")[0];
          const [created] = await tx.insert(subscriptions).values({
            userId,
            planId: planId as string,
            label: label as string,
            status: (status as "active" | "paused") ?? "active",
            startDate: startDateStr,
            activeUntil: activeUntilStr,
            masterUsername: masterUsername as string ?? null,
            masterPassword: await encryptCredential((masterPassword as string) || null) ?? null,
          }).returning();
          result = created;
        }
      });
      await setAuditLogNewValues(auditLogId, { result });
      return { message: `Subscription(s) ${operation}d.`, result };
    }

    case "managePayments": {
      const {
        operation,
        paymentId,
        amountPaid,
        paidOn,
        notes,
        periodStart,
        periodEnd,
        clientSubscriptionId,
      } = pendingChanges;
      if (!paymentId) throw new Error("Missing paymentId");

      const payment = await db.query.renewalLogs.findFirst({
        where: eq(renewalLogs.id, paymentId as string),
        with: {
          clientSubscription: {
            with: {
              subscription: { columns: { userId: true } },
            },
          },
        },
      });
      if (!payment || payment.clientSubscription?.subscription.userId !== userId) throw new Error("Payment record not found or access denied.");

      if (operation === "delete") {
        await runMutationInTransaction(db, async (tx) => {
          await tx.delete(renewalLogs).where(eq(renewalLogs.id, paymentId as string));

          // If this was the latest payment for this seat, revert activeUntil to periodStart
          if (payment.clientSubscriptionId) {
            const laterLogs = await tx.query.renewalLogs.findMany({
              where: and(
                eq(renewalLogs.clientSubscriptionId, payment.clientSubscriptionId),
                gte(renewalLogs.paidOn, payment.paidOn),
                ne(renewalLogs.id, payment.id),
              ),
              orderBy: [desc(renewalLogs.paidOn)],
              limit: 1,
            });

            if (!laterLogs.length) {
              // No later payments — revert activeUntil back to what it was before this payment
              await tx.update(clientSubscriptions).set({ activeUntil: payment.periodStart }).where(eq(clientSubscriptions.id, payment.clientSubscriptionId));
            }
          }
        });

        await setAuditLogNewValues(auditLogId, { deleted: true, paymentId });
        return { message: `Payment deleted successfully.` };
      }

      // Update operation
      const [updated] = await runMutationInTransaction(db, async (tx) => {
        let nextClientSubscriptionId: string | undefined;
        let nextExpectedAmount: number | undefined;

        if (clientSubscriptionId !== undefined) {
          const nextSeat = await tx.query.clientSubscriptions.findFirst({
            where: eq(clientSubscriptions.id, clientSubscriptionId as string),
            with: {
              subscription: {
                columns: { userId: true },
              },
            },
          });

          if (!nextSeat || nextSeat.subscription.userId !== userId) {
            throw new Error("Target seat not found or access denied.");
          }

          nextClientSubscriptionId = nextSeat.id;
          nextExpectedAmount = Number(nextSeat.customPrice);
        }

        const paidOnStr = paidOn
          ? (typeof paidOn === "string" ? paidOn : new Date(paidOn as string).toISOString().split("T")[0])
          : undefined;
        const periodStartStr = periodStart
          ? (typeof periodStart === "string" ? periodStart : new Date(periodStart as string).toISOString().split("T")[0])
          : undefined;
        const periodEndStr = periodEnd
          ? (typeof periodEnd === "string" ? periodEnd : new Date(periodEnd as string).toISOString().split("T")[0])
          : undefined;
        return tx.update(renewalLogs).set({
          ...(amountPaid !== undefined ? { amountPaid: amountToCents(amountPaid as number) } : {}),
          ...(paidOnStr ? { paidOn: paidOnStr } : {}),
          ...(notes !== undefined ? { notes: notes as string } : {}),
          ...(periodStartStr ? { periodStart: periodStartStr } : {}),
          ...(periodEndStr ? { periodEnd: periodEndStr } : {}),
          ...(nextClientSubscriptionId ? { clientSubscriptionId: nextClientSubscriptionId } : {}),
          ...(nextExpectedAmount !== undefined ? { expectedAmount: amountToCents(nextExpectedAmount) } : {}),
        }).where(eq(renewalLogs.id, paymentId as string)).returning();
      });

      await setAuditLogNewValues(auditLogId, {
        amountPaid: Number(updated.amountPaid),
        paidOn: updated.paidOn,
        notes: updated.notes,
        periodStart: updated.periodStart,
        periodEnd: updated.periodEnd,
        clientSubscriptionId: updated.clientSubscriptionId,
        expectedAmount: Number(updated.expectedAmount),
      });

      return { message: `Payment updated successfully.`, payment: updated };
    }

    case "managePlatformPayments": {
      const {
        operation,
        paymentId,
        amountPaid,
        paidOn,
        notes,
        periodStart,
        periodEnd,
        subscriptionId,
      } = pendingChanges;
      if (!paymentId) throw new Error("Missing paymentId");

      const payment = await db.query.platformRenewals.findFirst({
        where: eq(platformRenewals.id, paymentId as string),
        with: {
          subscription: {
            columns: { userId: true },
          },
        },
      });
      if (!payment || payment.subscription.userId !== userId) {
        throw new Error("Platform payment record not found or access denied.");
      }

      if (operation === "delete") {
        await runMutationInTransaction(db, async (tx) => {
          await tx.delete(platformRenewals).where(eq(platformRenewals.id, paymentId as string));
        });

        await setAuditLogNewValues(auditLogId, { deleted: true, paymentId });
        return { message: "Platform payment deleted successfully." };
      }

      const [updated] = await runMutationInTransaction(db, async (tx) => {
        let nextSubscriptionId: string | undefined;

        if (subscriptionId !== undefined) {
          const nextSubscription = await tx.query.subscriptions.findFirst({
            where: eq(subscriptions.id, subscriptionId as string),
            columns: { id: true, userId: true },
          });

          if (!nextSubscription || nextSubscription.userId !== userId) {
            throw new Error("Target subscription not found or access denied.");
          }

          nextSubscriptionId = nextSubscription.id;
        }

        const paidOnStr = paidOn
          ? (typeof paidOn === "string" ? paidOn : new Date(paidOn as string).toISOString().split("T")[0])
          : undefined;
        const periodStartStr = periodStart
          ? (typeof periodStart === "string" ? periodStart : new Date(periodStart as string).toISOString().split("T")[0])
          : undefined;
        const periodEndStr = periodEnd
          ? (typeof periodEnd === "string" ? periodEnd : new Date(periodEnd as string).toISOString().split("T")[0])
          : undefined;

        return tx.update(platformRenewals).set({
          ...(amountPaid !== undefined ? { amountPaid: amountToCents(amountPaid as number) } : {}),
          ...(paidOnStr ? { paidOn: paidOnStr } : {}),
          ...(notes !== undefined ? { notes: notes as string } : {}),
          ...(periodStartStr ? { periodStart: periodStartStr } : {}),
          ...(periodEndStr ? { periodEnd: periodEndStr } : {}),
          ...(nextSubscriptionId ? { subscriptionId: nextSubscriptionId } : {}),
        }).where(eq(platformRenewals.id, paymentId as string)).returning();
      });

      await setAuditLogNewValues(auditLogId, {
        amountPaid: Number(updated.amountPaid),
        paidOn: updated.paidOn,
        notes: updated.notes,
        periodStart: updated.periodStart,
        periodEnd: updated.periodEnd,
        subscriptionId: updated.subscriptionId,
      });

      return { message: "Platform payment updated successfully.", payment: updated };
    }

    case "bulkManageSeats": {
      const { operation, clientSubscriptionIds } = pendingChanges;
      if (!clientSubscriptionIds || !Array.isArray(clientSubscriptionIds) || !clientSubscriptionIds.length) {
        throw new Error("Missing clientSubscriptionIds");
      }

      const targetStatus = operation === "pause" ? "paused" : "active";

      await runMutationInTransaction(db, async (tx) => {
        // Validate ownership
        const toUpdate = await tx.query.clientSubscriptions.findMany({
          where: inArray(clientSubscriptions.id, clientSubscriptionIds as string[]),
          with: { client: { columns: { userId: true } } },
          columns: { id: true },
        });
        const validIds = toUpdate.filter((s) => s.client.userId === userId).map((s) => s.id);
        if (validIds.length > 0) {
          await tx.update(clientSubscriptions).set({ status: targetStatus }).where(inArray(clientSubscriptions.id, validIds));
        }
      });

      await setAuditLogNewValues(auditLogId, { status: targetStatus, count: (clientSubscriptionIds as string[]).length });
      return { message: `${(clientSubscriptionIds as string[]).length} seat(s) ${targetStatus === "paused" ? "paused" : "resumed"} successfully.` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
