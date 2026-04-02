/**
 * Mutation Token System — Cryptographic gating for AI-driven database mutations.
 *
 * Flow:
 *   1. AI tool proposes a mutation → createMutationToken() generates a token + audit row
 *   2. User clicks "Accept" → frontend POSTs the token to /api/mutations/execute
 *   3. validateAndConsumeMutationToken() verifies token, returns stored payload
 *   4. The execute endpoint applies the mutation inside a transaction
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mutationAuditLogs } from "@/db/schema";

const TOKEN_TTL_MINUTES = 5;

export interface MutationPayload {
  toolName: string;
  targetId?: string;
  action: "create" | "update" | "delete";
  changes: Record<string, unknown> | unknown[];
  previousValues: Record<string, unknown> | unknown[] | null;
  /** Extra context needed for execution (e.g. clientSubscriptionId for logPayment) */
  executionContext?: Record<string, unknown>;
}

/**
 * Generate a crypto token and store a pending mutation in the audit log.
 * Returns the token and audit log ID so the frontend can reference them.
 */
export async function createMutationToken(
  userId: string,
  payload: MutationPayload
): Promise<{ token: string; auditLogId: string; expiresAt: Date }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); // 64-char hex string
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  const [auditLog] = await db.insert(mutationAuditLogs).values({
    userId,
    toolName: payload.toolName,
    targetId: payload.targetId ?? null,
    action: payload.action,
    previousValues: (payload.previousValues ?? null) as any,
    // newValues is set AFTER execution
    token,
    expiresAt,
  }).returning({ id: mutationAuditLogs.id });

  return { token, auditLogId: auditLog.id, expiresAt: new Date(expiresAt) };
}

/**
 * Validate a mutation token:
 *   - Exists and belongs to the user
 *   - Has not been consumed (executedAt is null)
 *   - Has not expired
 *
 * On success, marks the token as consumed (sets executedAt) and returns the audit log row.
 * On failure, throws an Error with a human-readable message.
 */
export async function validateAndConsumeMutationToken(
  token: string,
  userId: string
) {
  const auditLog = await db.query.mutationAuditLogs.findFirst({
    where: eq(mutationAuditLogs.token, token),
  });

  if (!auditLog) {
    throw new Error("Invalid or not found token.");
  }

  if (auditLog.userId !== userId) {
    throw new Error("Token does not belong to this user.");
  }

  if (auditLog.executedAt) {
    throw new Error("This change has already been executed.");
  }

  if (new Date() > new Date(auditLog.expiresAt)) {
    throw new Error("Token has expired. Propose the change again.");
  }

  // Mark as consumed atomically. Under concurrent accepts, only one request can
  // transition executedAt from null -> timestamp.
  const consumedAt = new Date().toISOString();
  const consumedRows = await db
    .update(mutationAuditLogs)
    .set({ executedAt: consumedAt })
    .where(
      and(
        eq(mutationAuditLogs.id, auditLog.id),
        eq(mutationAuditLogs.userId, userId),
        isNull(mutationAuditLogs.executedAt)
      )
    )
    .returning({ id: mutationAuditLogs.id });

  if (!consumedRows.length) {
    // Re-read to return a deterministic error in race conditions.
    const refreshed = await db.query.mutationAuditLogs.findFirst({
      where: eq(mutationAuditLogs.id, auditLog.id),
    });

    if (!refreshed) {
      throw new Error("Invalid or not found token.");
    }

    if (refreshed.executedAt) {
      throw new Error("This change has already been executed.");
    }

    if (new Date() > new Date(refreshed.expiresAt)) {
      throw new Error("Token has expired. Propose the change again.");
    }

    throw new Error("Unable to consume mutation token. Please retry.");
  }

  return { ...auditLog, executedAt: consumedAt };
}

/**
 * Re-open a consumed token when execution fails after consumption.
 * This allows the user to retry the exact same accepted action.
 */
export async function rollbackConsumedMutationToken(
  auditLogId: string,
  userId: string
) {
  await db
    .update(mutationAuditLogs)
    .set({ executedAt: null })
    .where(and(eq(mutationAuditLogs.id, auditLogId), eq(mutationAuditLogs.userId, userId)));
}

/**
 * Mark an audit log entry as undone.
 */
export async function markAuditLogUndone(auditLogId: string) {
  await db.update(mutationAuditLogs).set({ undone: true, undoneAt: new Date().toISOString() }).where(eq(mutationAuditLogs.id, auditLogId));
}

/**
 * Store the newValues snapshot after a mutation has been executed.
 */
export async function setAuditLogNewValues(
  auditLogId: string,
  newValues: Record<string, unknown>
) {
  await db.update(mutationAuditLogs).set({ newValues: newValues as any }).where(eq(mutationAuditLogs.id, auditLogId));
}
