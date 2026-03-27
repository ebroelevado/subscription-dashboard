import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { subscriptions } from "./subscriptions";

export const platformRenewals = sqliteTable(
  "platform_renewals",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    amountPaid: integer("amount_paid").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    paidOn: text("paid_on").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    notes: text("notes"),
  },
  (table) => [
    index("platform_renewals_subscription_id_index").on(table.subscriptionId),
    index("platform_renewals_paid_on_index").on(table.paidOn),
  ],
);

export const platformRenewalsRelations = relations(platformRenewals, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [platformRenewals.subscriptionId],
    references: [subscriptions.id],
  }),
}));
