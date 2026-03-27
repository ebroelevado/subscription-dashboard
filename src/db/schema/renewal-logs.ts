import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { clientSubscriptions } from "./client-subscriptions";

export const renewalLogs = sqliteTable(
  "renewal_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    clientSubscriptionId: text("client_subscription_id").references(
      () => clientSubscriptions.id,
    ),
    amountPaid: integer("amount_paid").notNull(),
    expectedAmount: integer("expected_amount").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    paidOn: text("paid_on").notNull(),
    dueOn: text("due_on").notNull(),
    monthsRenewed: integer("months_renewed").default(1).notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("renewal_logs_client_subscription_id_index").on(table.clientSubscriptionId),
    index("renewal_logs_paid_on_index").on(table.paidOn),
  ],
);

export const renewalLogsRelations = relations(renewalLogs, ({ one }) => ({
  clientSubscription: one(clientSubscriptions, {
    fields: [renewalLogs.clientSubscriptionId],
    references: [clientSubscriptions.id],
  }),
}));
