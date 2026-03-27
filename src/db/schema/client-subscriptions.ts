import {
  sqliteTable,
  text,
  integer,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { clientSubscriptionStatusValues } from "./enums";
import { relations } from "drizzle-orm";
import { clients } from "./clients";
import { subscriptions } from "./subscriptions";
import { renewalLogs } from "./renewal-logs";

export const clientSubscriptions = sqliteTable(
  "client_subscriptions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    customPrice: integer("custom_price").notNull(),
    activeUntil: text("active_until").notNull(),
    joinedAt: text("joined_at").notNull(),
    leftAt: text("left_at"),
    status: text("status", { enum: clientSubscriptionStatusValues }).default("active").notNull(),
    remainingDays: integer("remaining_days"),
    servicePassword: text("service_password"),
    serviceUser: text("service_user"),
  },
  (table) => [
    unique().on(table.clientId, table.subscriptionId),
    index("client_subscriptions_client_id_index").on(table.clientId),
    index("client_subscriptions_subscription_id_index").on(table.subscriptionId),
    index("client_subscriptions_status_index").on(table.status),
  ],
);

export const clientSubscriptionsRelations = relations(
  clientSubscriptions,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [clientSubscriptions.clientId],
      references: [clients.id],
    }),
    subscription: one(subscriptions, {
      fields: [clientSubscriptions.subscriptionId],
      references: [subscriptions.id],
    }),
    renewalLogs: many(renewalLogs),
  }),
);
