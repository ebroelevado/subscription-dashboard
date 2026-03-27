import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export const mutationAuditLogs = sqliteTable(
  "mutation_audit_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    targetId: text("target_id"),
    action: text("action").notNull(),
    previousValues: text("previous_values", { mode: "json" }).$type<any>(),
    newValues: text("new_values", { mode: "json" }).$type<any>(),
    undone: integer("undone", { mode: "boolean" }).default(false).notNull(),
    undoneAt: text("undone_at"),
    token: text("token").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    executedAt: text("executed_at"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("mutation_audit_logs_user_id_index").on(table.userId),
    index("mutation_audit_logs_token_index").on(table.token),
  ],
);

export const mutationAuditLogsRelations = relations(mutationAuditLogs, ({ one }) => ({
  user: one(users, {
    fields: [mutationAuditLogs.userId],
    references: [users.id],
  }),
}));
