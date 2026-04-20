import { and, eq, isNull, sql } from "drizzle-orm";
import {
  agentMessages,
  agentRuns,
  agentToolCalls,
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
  const startedAt = nowIso();
  const finishedAt = nowIso();

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

  await db.insert(agentToolCalls).values(
    toolCalls.map((toolCall) => {
      const toolCallId = normalizeCallId(toolCall);
      const toolResult = toolCallId ? resultMap.get(toolCallId) : null;
      const errorMessage = getErrorMessage(toolResult?.error);
      const status: AgentToolCallStatus = errorMessage ? "error" : "success";

      return {
        runId: input.runId,
        stepNumber: input.stepNumber,
        toolName: normalizeToolName(toolCall),
        toolCallId,
        status,
        input: normalizeToolInput(toolCall) as any,
        output: normalizeToolResult(toolResult) as any,
        errorMessage,
        startedAt,
        finishedAt,
        durationMs: 0,
      };
    }),
  );
}
