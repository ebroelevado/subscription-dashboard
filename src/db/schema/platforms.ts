import { sqliteTable, text, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { plans } from "./plans";

export const platforms = sqliteTable(
  "platforms",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("platforms_user_id_index").on(table.userId),
    unique("unique_user_platform").on(table.userId, table.name),
  ],
);

export const platformsRelations = relations(platforms, ({ one, many }) => ({
  user: one(users, {
    fields: [platforms.userId],
    references: [users.id],
  }),
  plans: many(plans),
}));
