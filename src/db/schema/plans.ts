import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { platforms } from "./platforms";
import { subscriptions } from "./subscriptions";

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    platformId: text("platform_id")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cost: integer("cost").notNull(),
    maxSeats: integer("max_seats"),
    isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("plans_user_id_index").on(table.userId)],
);

export const plansRelations = relations(plans, ({ one, many }) => ({
  platform: one(platforms, {
    fields: [plans.platformId],
    references: [platforms.id],
  }),
  user: one(users, {
    fields: [plans.userId],
    references: [users.id],
  }),
  subscriptions: many(subscriptions),
}));
