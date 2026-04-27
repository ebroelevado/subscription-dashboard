import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { subscriptionStatusValues } from "./enums";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { plans } from "./plans";
import { clients } from "./clients";
import { clientSubscriptions } from "./client-subscriptions";
import { platformRenewals } from "./platform-renewals";

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    startDate: text("start_date").notNull(),
    activeUntil: text("active_until").notNull(),
    status: text("status", { enum: subscriptionStatusValues }).default("active").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    masterPassword: text("master_password"),
    masterUsername: text("master_username"),
    ownerId: text("owner_id"),
    autoRenewal: integer("auto_renewal", { mode: "boolean" }).default(true).notNull(),
    defaultPaymentNote: text("default_payment_note").default("como pago"),
  },
  (table) => [index("subscriptions_user_id_index").on(table.userId)],
);

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  plan: one(plans, {
    fields: [subscriptions.planId],
    references: [plans.id],
  }),
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
  owner: one(clients, {
    fields: [subscriptions.ownerId],
    references: [clients.id],
    relationName: "SubscriptionOwner",
  }),
  clientSubscriptions: many(clientSubscriptions),
  platformRenewals: many(platformRenewals),
}));
