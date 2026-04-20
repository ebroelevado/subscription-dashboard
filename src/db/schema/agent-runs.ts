import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { mutationAuditLogs } from "./mutation-audit-logs";

export const agentRunStatusValues = ["running", "completed", "failed", "aborted"] as const;
export const agentMessageRoleValues = ["user", "assistant", "system"] as const;
export const agentToolCallStatusValues = ["success", "error"] as const;

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: agentRunStatusValues }).notNull().default("running"),
    model: text("model").notNull(),
    source: text("source").notNull().default("durable_object"),
    allowDestructive: integer("allow_destructive", { mode: "boolean" })
      .notNull()
      .default(false),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull().$defaultFn(() => new Date().toISOString()),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("agent_runs_user_id_index").on(table.userId),
    index("agent_runs_status_index").on(table.status),
    index("agent_runs_started_at_index").on(table.startedAt),
  ],
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    role: text("role", { enum: agentMessageRoleValues }).notNull(),
    sequence: integer("sequence").notNull(),
    content: text("content", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("agent_messages_run_id_index").on(table.runId),
    index("agent_messages_run_sequence_index").on(table.runId, table.sequence),
  ],
);

export const agentToolCalls = sqliteTable(
  "agent_tool_calls",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    toolName: text("tool_name").notNull(),
    toolCallId: text("tool_call_id"),
    dedupeHash: text("dedupe_hash"),
    status: text("status", { enum: agentToolCallStatusValues }).notNull(),
    input: text("input", { mode: "json" }).$type<unknown>(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    mutationAuditLogId: text("mutation_audit_log_id").references(() => mutationAuditLogs.id, {
      onDelete: "set null",
    }),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull().$defaultFn(() => new Date().toISOString()),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("agent_tool_calls_run_id_index").on(table.runId),
    index("agent_tool_calls_run_step_index").on(table.runId, table.stepNumber),
    index("agent_tool_calls_run_tool_call_id_index").on(table.runId, table.toolCallId),
    uniqueIndex("agent_tool_calls_run_dedupe_unique").on(table.runId, table.dedupeHash),
    index("agent_tool_calls_audit_log_index").on(table.mutationAuditLogId),
  ],
);

export const agentArtifacts = sqliteTable(
  "agent_artifacts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label"),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("agent_artifacts_run_id_index").on(table.runId),
    index("agent_artifacts_run_kind_index").on(table.runId, table.kind),
  ],
);

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  user: one(users, {
    fields: [agentRuns.userId],
    references: [users.id],
  }),
  messages: many(agentMessages),
  toolCalls: many(agentToolCalls),
  artifacts: many(agentArtifacts),
}));

export const agentMessagesRelations = relations(agentMessages, ({ one }) => ({
  run: one(agentRuns, {
    fields: [agentMessages.runId],
    references: [agentRuns.id],
  }),
}));

export const agentToolCallsRelations = relations(agentToolCalls, ({ one }) => ({
  run: one(agentRuns, {
    fields: [agentToolCalls.runId],
    references: [agentRuns.id],
  }),
}));

export const agentArtifactsRelations = relations(agentArtifacts, ({ one }) => ({
  run: one(agentRuns, {
    fields: [agentArtifacts.runId],
    references: [agentRuns.id],
  }),
}));
