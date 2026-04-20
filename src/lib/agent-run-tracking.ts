import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  agentMessages,
  agentRuns,
  agentToolCalls,
  mutationAuditLogs,
} from "@/db/schema";
import type { SchemaDatabase } from "@/db";

type AgentRunStatus = "running" | "completed" | "failed" | "aborted";
type AgentMessageRole = "user" | "assistant" | "system";
type AgentToolCallStatus = "success" | "error";

interface StartAgentRunInput {
  userId: string;
  model: string;
  source?: string;
  allowDestructive: boolean;
}

interface AgentMessageInput {
  runId: string;
  role: AgentMessageRole;
  content: unknown;
}

interface FinalizeAgentRunInput {
  runId: string;
  status: Exclude<AgentRunStatus, "running">;
  errorMessage?: string;
}

interface RecordStepToolCallsInput {
  runId: string;
  stepNumber: number;
  toolCalls: unknown[];
  toolResults: unknown[];
  toolMetrics?: Map<string, {
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    errorMessage?: string | null;
  }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getErrorMessage(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeCallId(toolCall: any): string | null {
  return toolCall?.toolCallId ?? toolCall?.id ?? null;
}

function normalizeToolName(toolCall: any): string {
  return toolCall?.toolName ?? toolCall?.name ?? "unknown_tool";
}

function normalizeToolInput(toolCall: any): unknown {
  if (toolCall?.input !== undefined) return toolCall.input;
  if (toolCall?.args !== undefined) return toolCall.args;
  return null;
}

function normalizeToolResult(toolResult: any): unknown {
  if (toolResult?.result !== undefined) return toolResult.result;
  if (toolResult?.output !== undefined) return toolResult.output;
  return null;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);

  return `{${entries.join(",")}}`;
}

function createDedupeHash(input: { toolCallId: string | null; toolName: string; toolInput: unknown; }): string {
  if (input.toolCallId) {
    return `tool-call-id:${input.toolCallId}`;
  }
  return `tool-name:${input.toolName}|tool-input:${stableStringify(input.toolInput)}`;
}

function findProposalToken(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findProposalToken(item);
      if (token) return token;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.__token === "string" && record.__token.length > 0) {
    return record.__token;
  }

  for (const nestedValue of Object.values(record)) {
    const token = findProposalToken(nestedValue);
    if (token) return token;
  }

  return null;
}

async function resolveMutationAuditLogId(
  db: SchemaDatabase,
  toolOutput: unknown,
): Promise<string | null> {
  const token = findProposalToken(toolOutput);
  if (!token) return null;

  const auditRow = await db.query.mutationAuditLogs.findFirst({
    where: eq(mutationAuditLogs.token, token),
    columns: { id: true },
  });

  return auditRow?.id ?? null;
}

export async function startAgentRun(
  db: SchemaDatabase,
  input: StartAgentRunInput,
): Promise<{ id: string }> {
  const [run] = await db
    .insert(agentRuns)
    .values({
      userId: input.userId,
      model: input.model,
      source: input.source ?? "durable_object",
      allowDestructive: input.allowDestructive,
      status: "running",
    })
    .returning({ id: agentRuns.id });

  return run;
}

export async function appendAgentMessage(
  db: SchemaDatabase,
  input: AgentMessageInput,
): Promise<void> {
  const [sequenceRow] = await db
    .select({
      maxSequence: sql<number>`coalesce(max(${agentMessages.sequence}), -1)`,
    })
    .from(agentMessages)
    .where(eq(agentMessages.runId, input.runId))
    .limit(1);

  const parsedMaxSequence = Number(sequenceRow?.maxSequence ?? -1);
  const maxSequence = Number.isFinite(parsedMaxSequence)
    ? parsedMaxSequence
    : -1;
  const sequence = maxSequence + 1;

  await db.insert(agentMessages).values({
    runId: input.runId,
    role: input.role,
    sequence,
    content: input.content as any,
  });
}

export async function finalizeAgentRun(
  db: SchemaDatabase,
  input: FinalizeAgentRunInput,
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      finishedAt: nowIso(),
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(agentRuns.id, input.runId),
        isNull(agentRuns.finishedAt),
      ),
    );
}

export async function recordStepToolCalls(
  db: SchemaDatabase,
  input: RecordStepToolCallsInput,
): Promise<void> {
  const fallbackStartedAt = nowIso();
  const fallbackFinishedAt = nowIso();

  const toolCalls = asArray(input.toolCalls);
  if (!toolCalls.length) return;

  const toolResults = asArray(input.toolResults);
  const resultMap = new Map<string, any>();

  for (const result of toolResults) {
    const callId = normalizeCallId(result);
    if (callId) {
      resultMap.set(callId, result);
    }
  }

  const candidateRows = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const toolCallId = normalizeCallId(toolCall);
      const toolName = normalizeToolName(toolCall);
      const toolInput = normalizeToolInput(toolCall);
      const dedupeHash = createDedupeHash({ toolCallId, toolName, toolInput });
      const toolResult = toolCallId ? resultMap.get(toolCallId) : null;
      const normalizedOutput = normalizeToolResult(toolResult);
      const runtimeMetric = toolCallId ? input.toolMetrics?.get(toolCallId) : undefined;
      const errorMessage = runtimeMetric?.errorMessage ?? getErrorMessage(toolResult?.error);
      const status: AgentToolCallStatus = errorMessage ? "error" : "success";
      const mutationAuditLogId = await resolveMutationAuditLogId(db, normalizedOutput);

      return {
        runId: input.runId,
        stepNumber: input.stepNumber,
        toolName,
        toolCallId,
        dedupeHash,
        status,
        input: toolInput as any,
        output: normalizedOutput as any,
        mutationAuditLogId,
        errorMessage,
        startedAt: runtimeMetric?.startedAt ?? fallbackStartedAt,
        finishedAt: runtimeMetric?.finishedAt ?? fallbackFinishedAt,
        durationMs: typeof runtimeMetric?.durationMs === "number" ? runtimeMetric.durationMs : 0,
      };
    }),
  );

  const dedupeHashes = candidateRows.map((row) => row.dedupeHash);
  const existingRows = dedupeHashes.length
    ? await db
      .select({ dedupeHash: agentToolCalls.dedupeHash })
      .from(agentToolCalls)
      .where(
        and(
          eq(agentToolCalls.runId, input.runId),
          inArray(agentToolCalls.dedupeHash, dedupeHashes),
        ),
      )
    : [];

  const existingHashSet = new Set(existingRows.map((row) => row.dedupeHash));
  const rowsToInsert = candidateRows.filter((row) => !existingHashSet.has(row.dedupeHash));
  if (!rowsToInsert.length) return;

  await db.insert(agentToolCalls).values(rowsToInsert as any);
}
