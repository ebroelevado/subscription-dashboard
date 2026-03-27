import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { clientSubscriptions } from "./client-subscriptions";
import { subscriptions } from "./subscriptions";

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    phone: text("phone"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dailyPenalty: integer("daily_penalty"),
    daysOverdue: integer("days_overdue").default(0).notNull(),
    disciplineScore: text("discipline_score"),
    healthStatus: text("health_status"),
  },
  (table) => [index("clients_user_id_index").on(table.userId)],
);

export const clientsRelations = relations(clients, ({ one, many }) => ({
  user: one(users, {
    fields: [clients.userId],
    references: [users.id],
  }),
  clientSubscriptions: many(clientSubscriptions),
  ownedSubscriptions: many(subscriptions, {
    relationName: "SubscriptionOwner",
  }),
}));
