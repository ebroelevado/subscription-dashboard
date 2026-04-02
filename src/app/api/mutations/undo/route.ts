/**
 * POST /api/mutations/undo
 *
 * Direct undo endpoint — bypasses the AI entirely.
 * The frontend calls this when the user clicks "Ir Atrás" on an executed mutation.
 *
 * Body: { auditLogId: string }
 * Loads the audit log, verifies ownership, restores previousValues in a transaction,
 * and creates a new audit entry with action="undo".
 */

import { getAuthSession } from "@/lib/auth-utils";
import {
  buildDeletedClientRestoreData,
  parseDeletedClientSnapshots,
} from "@/lib/client-deletion-snapshot";
import { encryptCredential } from "@/lib/credential-encryption";
import { db } from "@/db";
import { eq, and, inArray } from "drizzle-orm";
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
import { markAuditLogUndone } from "@/lib/mutation-token";
import { amountToCents } from "@/lib/currency";

function parseJsonField(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value);
  return value as Record<string, unknown>;
}

function parseJsonArray(value: unknown): unknown[] {
  if (!value) return [];
  if (typeof value === "string") return JSON.parse(value);
  return value as unknown[];
}

async function runUndoInTransaction(fn: (tx: typeof db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => fn(tx as unknown as typeof db));
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const beginUnsupported =
      message.includes("Failed query: begin") ||
      message.includes("cannot start a transaction") ||
      message.includes('near "begin"');

    if (!beginUnsupported) {
      throw error;
    }

    console.warn("[Mutations/Undo] Transaction BEGIN unsupported. Retrying without explicit transaction.");
    await fn(db as unknown as typeof db);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { auditLogId } = await req.json();
    if (!auditLogId || typeof auditLogId !== "string") {
      return Response.json({ error: "Missing auditLogId" }, { status: 400 });
    }

    // Load the audit log entry
    const auditLog = await db.query.mutationAuditLogs.findFirst({
      where: eq(mutationAuditLogs.id, auditLogId),
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

    const previousValues = parseJsonField(auditLog.previousValues);
    const toolName = auditLog.toolName;
    const targetId = auditLog.targetId;

    // Execute the undo inside a transaction
    await undoMutation(userId, toolName, targetId, previousValues, auditLog.action);

    // Mark the original audit log as undone
    await markAuditLogUndone(auditLogId);

    // Create a new audit log entry for the undo action
    await db.insert(mutationAuditLogs).values({
      userId,
      toolName,
      targetId,
      action: "undo",
      previousValues: (auditLog.newValues ?? null) as any,
      newValues: (previousValues ?? null) as any,
      token: (() => { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); })(),
      expiresAt: new Date().toISOString(),
      executedAt: new Date().toISOString(),
    });

    return Response.json({ success: true, message: "Action undone successfully." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error undoing mutation";
    console.error("[Mutations/Undo]", message);
    return Response.json({ error: message }, { status: 400 });
  }
}

/**
 * Helper: format a value as a date string "YYYY-MM-DD" for Drizzle date columns
 */
function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "string") {
    // If it's already "YYYY-MM-DD", return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(value).toISOString().split("T")[0];
  }
  return new Date().toISOString().split("T")[0];
}

/**
 * Restores previousValues inside a transaction based on tool type.
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
      const client = await db.query.clients.findFirst({
        where: and(eq(clients.id, targetId), eq(clients.userId, userId)),
      });
      if (!client) throw new Error("Client not found or unauthorized.");

      await runUndoInTransaction(async (tx) => {
        await tx.update(clients).set({
          name: previousValues.name as string,
          phone: (previousValues.phone as string) ?? null,
          notes: (previousValues.notes as string) ?? null,
        }).where(eq(clients.id, targetId));
      });
      break;
    }

    case "createClient": {
      // Undoing a creation = delete
      if (!targetId) throw new Error("Missing targetId");
      const client = await db.query.clients.findFirst({
        where: and(eq(clients.id, targetId), eq(clients.userId, userId)),
      });
      if (!client) throw new Error("Client not found.");

      await runUndoInTransaction(async (tx) => {
        await tx.delete(clients).where(eq(clients.id, targetId));
      });
      break;
    }

    case "updateUserConfig": {
      await runUndoInTransaction(async (tx) => {
        await tx.update(users).set(previousValues as Record<string, unknown>).where(eq(users.id, userId));
      });
      break;
    }

    case "assignClientToSubscription": {
      // Undoing an assignment = delete the pivot row
      if (!targetId) throw new Error("Missing targetId");
      const cs = await db.query.clientSubscriptions.findFirst({
        where: eq(clientSubscriptions.id, targetId),
        with: { client: { columns: { userId: true } } },
      });
      if (!cs || cs.client.userId !== userId) throw new Error("Assignment not found.");

      await runUndoInTransaction(async (tx) => {
        await tx.delete(clientSubscriptions).where(eq(clientSubscriptions.id, targetId));
      });
      break;
    }

    case "logPayment": {
      // Undoing a payment = delete the log + restore activeUntil
      if (!targetId) throw new Error("Missing targetId");
      const log = await db.query.renewalLogs.findFirst({
        where: eq(renewalLogs.id, targetId),
        with: {
          clientSubscription: {
            with: {
              subscription: { columns: { userId: true } },
            },
          },
        },
      });
      if (!log || log.clientSubscription?.subscription.userId !== userId) throw new Error("Payment log not found.");

      await runUndoInTransaction(async (tx) => {
        if (log.clientSubscriptionId) {
          await tx.update(clientSubscriptions).set({ activeUntil: log.dueOn }).where(eq(clientSubscriptions.id, log.clientSubscriptionId));
        }
        await tx.delete(renewalLogs).where(eq(renewalLogs.id, targetId));
      });
      break;
    }

    case "removeClientsFromSubscription": {
      const items = previousValues as unknown as Array<Record<string, unknown>>;
      if (!items || !items.length) break;
      await runUndoInTransaction(async (tx) => {
        // Insert client subscriptions back
        for (const item of items) {
          await tx.insert(clientSubscriptions).values({
            id: item.id as string,
            clientId: item.clientId as string,
            subscriptionId: item.subscriptionId as string,
            customPrice: amountToCents(item.customPrice as number),
            activeUntil: toDateStr(item.activeUntil),
            joinedAt: toDateStr(item.joinedAt),
            leftAt: item.leftAt ? toDateStr(item.leftAt) : null,
            status: item.status as "active" | "paused",
            remainingDays: item.remainingDays as number | null,
            serviceUser: await encryptCredential((item.serviceUser as string | null) ?? null) ?? null,
            servicePassword: await encryptCredential((item.servicePassword as string | null) ?? null) ?? null,
          }).onConflictDoNothing();
        }
        // Reconnect renewal logs whose clientSubscriptionId was set to NULL on cascade
        for (const item of items) {
          if (item.renewalLogs && Array.isArray(item.renewalLogs) && item.renewalLogs.length) {
            const logIds = (item.renewalLogs as Array<Record<string, unknown>>).map((rl) => rl.id as string);
            await tx.update(renewalLogs).set({ clientSubscriptionId: item.id as string }).where(inArray(renewalLogs.id, logIds));
          }
        }
      });
      break;
    }

    case "deleteClients": {
      const items = parseDeletedClientSnapshots(previousValues);
      if (!items || !items.length) break;
      const restoreData = buildDeletedClientRestoreData(userId, items);
      await runUndoInTransaction(async (tx) => {
        // Restore clients
        for (const c of restoreData.clients) {
          await tx.insert(clients).values({
            id: c.id,
            userId: c.userId,
            name: c.name,
            phone: c.phone,
            notes: c.notes,
            createdAt: typeof c.createdAt === "string" ? c.createdAt : (c.createdAt as Date).toISOString(),
            disciplineScore: c.disciplineScore,
            dailyPenalty: c.dailyPenalty !== null ? amountToCents(c.dailyPenalty) : null,
            daysOverdue: c.daysOverdue,
            healthStatus: c.healthStatus,
          }).onConflictDoNothing();
        }

        // Restore client subscriptions
        for (const cs of restoreData.clientSubscriptions) {
          await tx.insert(clientSubscriptions).values({
            id: cs.id,
            clientId: cs.clientId,
            subscriptionId: cs.subscriptionId,
            customPrice: amountToCents(cs.customPrice),
            activeUntil: toDateStr(cs.activeUntil),
            joinedAt: toDateStr(cs.joinedAt),
            leftAt: cs.leftAt ? toDateStr(cs.leftAt) : null,
            status: cs.status,
            remainingDays: cs.remainingDays,
            serviceUser: cs.serviceUser ?? null,
            servicePassword: cs.servicePassword ?? null,
          }).onConflictDoNothing();
        }

        // Restore renewal logs
        for (const rl of restoreData.renewalLogs) {
          await tx.insert(renewalLogs).values({
            id: rl.id,
            clientSubscriptionId: rl.clientSubscriptionId,
            amountPaid: amountToCents(rl.amountPaid),
            expectedAmount: amountToCents(rl.expectedAmount),
            periodStart: toDateStr(rl.periodStart),
            periodEnd: toDateStr(rl.periodEnd),
            paidOn: toDateStr(rl.paidOn),
            dueOn: toDateStr(rl.dueOn),
            monthsRenewed: rl.monthsRenewed,
            notes: rl.notes,
          }).onConflictDoUpdate({
            target: [renewalLogs.id],
            set: {
              clientSubscriptionId: rl.clientSubscriptionId,
              amountPaid: amountToCents(rl.amountPaid),
              expectedAmount: amountToCents(rl.expectedAmount),
              periodStart: toDateStr(rl.periodStart),
              periodEnd: toDateStr(rl.periodEnd),
              paidOn: toDateStr(rl.paidOn),
              dueOn: toDateStr(rl.dueOn),
              monthsRenewed: rl.monthsRenewed,
              notes: rl.notes,
            },
          });
        }

        // Restore subscription owners
        for (const ownerRestore of restoreData.subscriptionOwners) {
          await tx.update(subscriptions).set({ ownerId: ownerRestore.clientId }).where(
            and(
              inArray(subscriptions.id, ownerRestore.subscriptionIds),
              eq(subscriptions.userId, userId),
            ),
          );
        }
      });
      break;
    }

    case "managePlatforms": {
      if (action === "delete") {
        const items = previousValues as unknown as Array<Record<string, unknown>>;
        if (items && items.length) {
          for (const item of items) {
            await db.insert(platforms).values({
              id: item.id as string,
              name: item.name as string,
              userId,
            }).onConflictDoNothing();
          }
        }
      } else if (action === "update") {
        const items = previousValues as unknown as Array<Record<string, unknown>>;
        if (items && items[0]) {
          await db.update(platforms).set({ name: items[0].name as string }).where(eq(platforms.id, items[0].id as string));
        }
      }
      break;
    }

    case "managePlans": {
      if (action === "delete") {
        const items = previousValues as unknown as Array<Record<string, unknown>>;
        if (items && items.length) {
          for (const item of items) {
            await db.insert(plans).values({
              id: item.id as string,
              platformId: item.platformId as string,
              name: item.name as string,
              cost: amountToCents(item.cost as number),
              maxSeats: item.maxSeats as number | null,
              isActive: item.isActive as boolean,
              userId,
            }).onConflictDoNothing();
          }
        }
      } else if (action === "update") {
        const items = previousValues as unknown as Array<Record<string, unknown>>;
        if (items && items[0]) {
          await db.update(plans).set({
            name: items[0].name as string,
            cost: amountToCents(items[0].cost as number),
            maxSeats: items[0].maxSeats as number | null,
            isActive: items[0].isActive as boolean,
          }).where(eq(plans.id, items[0].id as string));
        }
      }
      break;
    }

    case "manageSubscriptions": {
      if (action === "delete") {
        const items = previousValues as unknown as Array<Record<string, unknown>>;
        if (!items || !items.length) break;
        await runUndoInTransaction(async (tx) => {
          for (const sub of items) {
            await tx.insert(subscriptions).values({
              id: sub.id as string,
              userId: sub.userId as string,
              planId: sub.planId as string,
              label: sub.label as string,
              startDate: toDateStr(sub.startDate),
              activeUntil: toDateStr(sub.activeUntil),
              status: sub.status as "active" | "paused",
              isAutopayable: sub.isAutopayable as boolean,
              masterUsername: (sub.masterUsername as string | null) ?? null,
              masterPassword: (sub.masterPassword as string | null) ?? null,
              defaultPaymentNote: (sub.defaultPaymentNote as string | null) ?? null,
              ownerId: (sub.ownerId as string | null) ?? null,
            }).onConflictDoNothing();

            if (sub.clientSubscriptions && Array.isArray(sub.clientSubscriptions) && sub.clientSubscriptions.length) {
              for (const cs of sub.clientSubscriptions as Array<Record<string, unknown>>) {
                await tx.insert(clientSubscriptions).values({
                  id: cs.id as string,
                  clientId: cs.clientId as string,
                  subscriptionId: cs.subscriptionId as string,
                  customPrice: amountToCents(cs.customPrice as number),
                  activeUntil: toDateStr(cs.activeUntil),
                  joinedAt: toDateStr(cs.joinedAt),
                  leftAt: cs.leftAt ? toDateStr(cs.leftAt) : null,
                  status: cs.status as "active" | "paused",
                  remainingDays: (cs.remainingDays as number | null) ?? null,
                  serviceUser: await encryptCredential((cs.serviceUser as string | null) ?? null) ?? null,
                  servicePassword: await encryptCredential((cs.servicePassword as string | null) ?? null) ?? null,
                }).onConflictDoNothing();

                if (cs.renewalLogs && Array.isArray(cs.renewalLogs) && cs.renewalLogs.length) {
                  const csLogIds = (cs.renewalLogs as Array<Record<string, unknown>>).map((rl) => rl.id as string);
                  await tx.update(renewalLogs).set({ clientSubscriptionId: cs.id as string }).where(inArray(renewalLogs.id, csLogIds));
                }
              }
            }

            if (sub.platformRenewals && Array.isArray(sub.platformRenewals) && sub.platformRenewals.length) {
              for (const pr of sub.platformRenewals as Array<Record<string, unknown>>) {
                await tx.insert(platformRenewals).values({
                  id: pr.id as string,
                  subscriptionId: pr.subscriptionId as string,
                  amountPaid: amountToCents(pr.amountPaid as number),
                  periodStart: toDateStr(pr.periodStart),
                  periodEnd: toDateStr(pr.periodEnd),
                  paidOn: toDateStr(pr.paidOn),
                  notes: (pr.notes as string | null) ?? null,
                }).onConflictDoNothing();
              }
            }
          }
        });
      } else if (action === "update") {
        const items = previousValues as unknown as Array<Record<string, unknown>>;
        if (items && items[0]) {
          await db.update(subscriptions).set(items[0] as Record<string, unknown>).where(eq(subscriptions.id, items[0].id as string));
        }
      }
      break;
    }

    case "managePayments": {
      const prev = previousValues as {
        id: string;
        amountPaid: number;
        expectedAmount: number;
        paidOn: string;
        periodStart: string;
        periodEnd: string;
        notes: string | null;
        clientSubscriptionId: string | null;
      };

      if (!prev?.id) throw new Error("Missing previousValues for managePayments undo.");

      if (action === "delete") {
        // The payment was deleted — we need to recreate it from previousValues
        const exists = await db.query.renewalLogs.findFirst({ where: eq(renewalLogs.id, prev.id) });
        if (!exists) {
          // Need clientSubscription context to find the right dueOn
          const csId = prev.clientSubscriptionId;
          const cs = csId
            ? await db.query.clientSubscriptions.findFirst({
                where: eq(clientSubscriptions.id, csId),
                with: { subscription: { columns: { userId: true } } },
              })
            : null;

          if (cs && cs.subscription.userId !== userId) throw new Error("Access denied.");

          await runUndoInTransaction(async (tx) => {
            await tx.insert(renewalLogs).values({
              id: prev.id,
              clientSubscriptionId: prev.clientSubscriptionId,
              amountPaid: amountToCents(prev.amountPaid),
              expectedAmount: amountToCents(prev.expectedAmount),
              paidOn: toDateStr(prev.paidOn),
              periodStart: toDateStr(prev.periodStart),
              periodEnd: toDateStr(prev.periodEnd),
              dueOn: cs?.activeUntil ?? toDateStr(prev.paidOn),
              monthsRenewed: 1,
              notes: prev.notes ?? null,
            });

            // Restore activeUntil on the seat to periodEnd (this payment covered up to periodEnd)
            if (csId) {
              await tx.update(clientSubscriptions).set({ activeUntil: toDateStr(prev.periodEnd) }).where(eq(clientSubscriptions.id, csId));
            }
          });
        }
      } else {
        // The payment was updated — restore original field values
        const log = await db.query.renewalLogs.findFirst({
          where: eq(renewalLogs.id, prev.id),
          with: {
            clientSubscription: {
              with: { subscription: { columns: { userId: true } } },
            },
          },
        });
        if (!log || log.clientSubscription?.subscription.userId !== userId) throw new Error("Payment log not found for undo.");

        await runUndoInTransaction(async (tx) => {
          await tx.update(renewalLogs).set({
            amountPaid: amountToCents(prev.amountPaid),
            paidOn: toDateStr(prev.paidOn),
            periodStart: toDateStr(prev.periodStart),
            periodEnd: toDateStr(prev.periodEnd),
            notes: prev.notes ?? null,
          }).where(eq(renewalLogs.id, prev.id));
        });
      }
      break;
    }

    case "bulkManageSeats": {
      // previousValues is an array of { id, clientName, subscriptionLabel, status }
      const items = previousValues as unknown as Array<{
        id: string;
        status: string;
      }>;
      if (!items || !items.length) break;

      await runUndoInTransaction(async (tx) => {
        // Restore each seat to its original status, grouped by status for efficiency
        const byStatus: Record<string, string[]> = {};
        for (const item of items) {
          if (!byStatus[item.status]) byStatus[item.status] = [];
          byStatus[item.status].push(item.id);
        }

        for (const [status, ids] of Object.entries(byStatus)) {
          // Verify ownership before updating
          const owned = await tx.query.clientSubscriptions.findMany({
            where: inArray(clientSubscriptions.id, ids),
            with: { client: { columns: { userId: true } } },
            columns: { id: true },
          });
          const validIds = owned.filter((s) => s.client.userId === userId).map((s) => s.id);
          if (validIds.length) {
            await tx.update(clientSubscriptions).set({ status: status as "active" | "paused" }).where(inArray(clientSubscriptions.id, validIds));
          }
        }
      });
      break;
    }

    default:
      throw new Error(`Unknown tool for undo: ${toolName}`);
  }
}
