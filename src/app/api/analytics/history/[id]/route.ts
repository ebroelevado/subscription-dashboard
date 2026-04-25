import { type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  clientSubscriptions,
  mutationAuditLogs,
  platformRenewals,
  renewalLogs,
  subscriptions,
} from "@/db/schema";
import { success, withErrorHandling } from "@/lib/api-utils";
import { amountToCents } from "@/lib/currency";
import { executeMutation, runMutationInTransaction } from "@/lib/mutation-executor";
import {
  createMutationToken,
  rollbackConsumedMutationToken,
  setAuditLogNewValues,
  validateAndConsumeMutationToken,
} from "@/lib/mutation-token";

type RouteParams = { params: Promise<{ id: string }> };

const historyMutationBaseSchema = z.object({
  type: z.enum(["income", "cost"]),
  reason: z.string().trim().min(3).max(300),
});

const updateHistoryEntrySchema = historyMutationBaseSchema
  .extend({
    nextType: z.enum(["income", "cost"]).optional(),
    amountPaid: z.number().min(0).optional(),
    paidOn: z.string().date().optional(),
    periodStart: z.string().date().optional(),
    periodEnd: z.string().date().optional(),
    notes: z.string().max(500).nullable().optional(),
    subscriptionId: z.string().min(1).optional(),
    clientSubscriptionId: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.amountPaid !== undefined ||
      data.paidOn !== undefined ||
      data.periodStart !== undefined ||
      data.periodEnd !== undefined ||
      data.notes !== undefined ||
      data.nextType !== undefined ||
      data.subscriptionId !== undefined ||
      data.clientSubscriptionId !== undefined,
    { message: "At least one editable field is required." }
  );

const deleteHistoryEntrySchema = historyMutationBaseSchema;

function getHistoryToolName(type: "income" | "cost") {
  return type === "income" ? "managePayments" : "managePlatformPayments";
}

async function buildIncomePreviousValues(id: string, userId: string) {
  const payment = await db.query.renewalLogs.findFirst({
    where: eq(renewalLogs.id, id),
    with: {
      clientSubscription: {
        with: {
          subscription: {
            columns: { userId: true },
          },
        },
      },
    },
  });

  if (!payment || payment.clientSubscription?.subscription.userId !== userId) {
    throw new Error("History entry not found or access denied.");
  }

  return {
    id: payment.id,
    amountPaid: Number(payment.amountPaid),
    expectedAmount: Number(payment.expectedAmount),
    paidOn: payment.paidOn,
    periodStart: payment.periodStart,
    periodEnd: payment.periodEnd,
    dueOn: payment.dueOn,
    monthsRenewed: payment.monthsRenewed,
    notes: payment.notes ?? null,
    clientSubscriptionId: payment.clientSubscriptionId,
  };
}

async function buildCostPreviousValues(id: string, userId: string) {
  const payment = await db.query.platformRenewals.findFirst({
    where: eq(platformRenewals.id, id),
    with: {
      subscription: {
        columns: { userId: true },
      },
    },
  });

  if (!payment || payment.subscription.userId !== userId) {
    throw new Error("History entry not found or access denied.");
  }

  return {
    id: payment.id,
    subscriptionId: payment.subscriptionId,
    amountPaid: Number(payment.amountPaid),
    paidOn: payment.paidOn,
    periodStart: payment.periodStart,
    periodEnd: payment.periodEnd,
    notes: payment.notes ?? null,
  };
}

async function executeHistoryTypeSwitch(input: {
  id: string;
  userId: string;
  fromType: "income" | "cost";
  toType: "income" | "cost";
  reason: string;
  amountPaid?: number;
  paidOn?: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string | null;
  subscriptionId?: string;
  clientSubscriptionId?: string;
}) {
  const {
    id,
    userId,
    fromType,
    toType,
    reason,
    amountPaid,
    paidOn,
    periodStart,
    periodEnd,
    notes,
    subscriptionId,
    clientSubscriptionId,
  } = input;

  if (fromType === toType) {
    throw new Error("Source and target type cannot be the same.");
  }

  const sourceIncome = fromType === "income"
    ? await buildIncomePreviousValues(id, userId)
    : null;
  const sourceCost = fromType === "cost"
    ? await buildCostPreviousValues(id, userId)
    : null;
  const sourceCommon = sourceIncome ?? sourceCost;

  if (!sourceCommon) {
    throw new Error("History entry not found or access denied.");
  }

  const nextAmountPaid = amountPaid !== undefined ? amountToCents(amountPaid) : sourceCommon.amountPaid;
  const nextPaidOn = paidOn ?? sourceCommon.paidOn;
  const nextPeriodStart = periodStart ?? sourceCommon.periodStart;
  const nextPeriodEnd = periodEnd ?? sourceCommon.periodEnd;
  const nextNotes = notes !== undefined ? notes : sourceCommon.notes;

  let targetSubscriptionId: string | undefined;
  let targetClientSubscriptionId: string | undefined;
  let targetExpectedAmount = 0;
  let targetMonthsRenewed = 1;
  let targetDueOn = nextPeriodStart;

  if (toType === "income") {
    const candidateSeatId = clientSubscriptionId ?? sourceIncome?.clientSubscriptionId ?? undefined;
    if (!candidateSeatId) {
      throw new Error("A target client subscription is required to convert to income.");
    }

    const validatedSeat = await db.query.clientSubscriptions.findFirst({
      where: eq(clientSubscriptions.id, candidateSeatId),
      with: {
        subscription: {
          columns: { userId: true },
        },
      },
    });

    if (!validatedSeat || validatedSeat.subscription.userId !== userId) {
      throw new Error("Target seat not found or access denied.");
    }

    targetClientSubscriptionId = validatedSeat.id;
    targetExpectedAmount = Number(validatedSeat.customPrice);
    targetMonthsRenewed = sourceIncome?.monthsRenewed ?? 1;
    targetDueOn = sourceIncome?.dueOn ?? nextPeriodStart;
  } else {
    const candidateSubscriptionId = subscriptionId ?? sourceCost?.subscriptionId ?? undefined;
    if (!candidateSubscriptionId) {
      throw new Error("A target subscription is required to convert to expense.");
    }

    const validatedSubscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, candidateSubscriptionId),
      columns: { id: true, userId: true },
    });

    if (!validatedSubscription || validatedSubscription.userId !== userId) {
      throw new Error("Target subscription not found or access denied.");
    }

    targetSubscriptionId = validatedSubscription.id;
  }

  const previousValues = {
    id,
    fromType,
    toType,
    fromRecord: sourceCommon,
  };

  const pendingChanges = {
    operation: "switchType",
    paymentId: id,
    reason,
    fromType,
    toType,
    amountPaid: nextAmountPaid,
    paidOn: nextPaidOn,
    periodStart: nextPeriodStart,
    periodEnd: nextPeriodEnd,
    notes: nextNotes,
    subscriptionId: targetSubscriptionId,
    clientSubscriptionId: targetClientSubscriptionId,
  };

  const { token } = await createMutationToken(userId, {
    toolName: "switchHistoryType",
    targetId: id,
    action: "update",
    changes: pendingChanges,
    previousValues,
  });

  await db
    .update(mutationAuditLogs)
    .set({ newValues: pendingChanges as any })
    .where(eq(mutationAuditLogs.token, token));

  const auditLog = await validateAndConsumeMutationToken(token, userId);

  try {
    await runMutationInTransaction(db, async (tx) => {
      if (fromType === "income") {
        await tx.delete(renewalLogs).where(eq(renewalLogs.id, id));
      } else {
        await tx.delete(platformRenewals).where(eq(platformRenewals.id, id));
      }

      if (toType === "income") {
        await tx.insert(renewalLogs).values({
          id,
          clientSubscriptionId: targetClientSubscriptionId ?? null,
          amountPaid: nextAmountPaid,
          expectedAmount: targetExpectedAmount,
          periodStart: nextPeriodStart,
          periodEnd: nextPeriodEnd,
          paidOn: nextPaidOn,
          dueOn: targetDueOn,
          monthsRenewed: targetMonthsRenewed,
          notes: nextNotes ?? null,
        });
      } else {
        await tx.insert(platformRenewals).values({
          id,
          subscriptionId: targetSubscriptionId as string,
          amountPaid: nextAmountPaid,
          periodStart: nextPeriodStart,
          periodEnd: nextPeriodEnd,
          paidOn: nextPaidOn,
          notes: nextNotes ?? null,
        });
      }
    });

    await setAuditLogNewValues(auditLog.id, {
      fromType,
      toType,
      amountPaid: nextAmountPaid,
      paidOn: nextPaidOn,
      periodStart: nextPeriodStart,
      periodEnd: nextPeriodEnd,
      notes: nextNotes,
      subscriptionId: targetSubscriptionId ?? null,
      clientSubscriptionId: targetClientSubscriptionId ?? null,
    });

    return {
      auditLogId: auditLog.id,
      result: { switched: true, fromType, toType, id },
    };
  } catch (error) {
    await rollbackConsumedMutationToken(auditLog.id, userId);
    throw error;
  }
}

async function executeHistoryMutation(input: {
  id: string;
  userId: string;
  type: "income" | "cost";
  reason: string;
  operation: "update" | "delete";
  amountPaid?: number;
  paidOn?: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string | null;
  subscriptionId?: string;
  clientSubscriptionId?: string;
}) {
  const {
    id,
    userId,
    type,
    reason,
    operation,
    amountPaid,
    paidOn,
    periodStart,
    periodEnd,
    notes,
    subscriptionId,
    clientSubscriptionId,
  } = input;

  const toolName = getHistoryToolName(type);
  const previousValues = type === "income"
    ? await buildIncomePreviousValues(id, userId)
    : await buildCostPreviousValues(id, userId);

  const pendingChanges = {
    operation,
    paymentId: id,
    reason,
    ...(amountPaid !== undefined ? { amountPaid } : {}),
    ...(paidOn !== undefined ? { paidOn } : {}),
    ...(periodStart !== undefined ? { periodStart } : {}),
    ...(periodEnd !== undefined ? { periodEnd } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(subscriptionId !== undefined ? { subscriptionId } : {}),
    ...(clientSubscriptionId !== undefined ? { clientSubscriptionId } : {}),
  };

  const { token } = await createMutationToken(userId, {
    toolName,
    targetId: id,
    action: operation,
    changes: pendingChanges,
    previousValues,
  });

  await db
    .update(mutationAuditLogs)
    .set({ newValues: pendingChanges as any })
    .where(eq(mutationAuditLogs.token, token));

  const auditLog = await validateAndConsumeMutationToken(token, userId);

  try {
    const result = await executeMutation(
      db,
      userId,
      auditLog.toolName,
      auditLog.targetId,
      auditLog.action as "create" | "update" | "delete",
      auditLog.previousValues as Record<string, unknown>,
      auditLog.id,
    );

    return {
      auditLogId: auditLog.id,
      result,
    };
  } catch (error) {
    await rollbackConsumedMutationToken(auditLog.id, userId);
    throw error;
  }
}

// PATCH /api/analytics/history/[id] — edit history entry (income or cost)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const data = updateHistoryEntrySchema.parse(await request.json());

    const mutation = data.nextType && data.nextType !== data.type
      ? await executeHistoryTypeSwitch({
          id,
          userId,
          fromType: data.type,
          toType: data.nextType,
          reason: data.reason,
          amountPaid: data.amountPaid,
          paidOn: data.paidOn,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          notes: data.notes,
          subscriptionId: data.subscriptionId,
          clientSubscriptionId: data.clientSubscriptionId,
        })
      : await executeHistoryMutation({
          id,
          userId,
          type: data.type,
          reason: data.reason,
          operation: "update",
          amountPaid: data.amountPaid,
          paidOn: data.paidOn,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          notes: data.notes,
          subscriptionId: data.subscriptionId,
          clientSubscriptionId: data.clientSubscriptionId,
        });

    return success(mutation);
  });
}

// DELETE /api/analytics/history/[id] — delete history entry (income or cost)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();
    const { id } = await params;

    const data = deleteHistoryEntrySchema.parse(await request.json());

    const mutation = await executeHistoryMutation({
      id,
      userId,
      type: data.type,
      reason: data.reason,
      operation: "delete",
    });

    return success(mutation);
  });
}
