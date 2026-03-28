import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Schema matches Better Auth expectations.
// The `token` column is required by Better Auth's Drizzle adapter 
// to manage session states and verification flows correctly.
// It is made nullable to avoid crashes during specific OAuth flows 
// where the token is not immediately available.
export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // `token` is the field BetterAuth uses as the primary lookup for verification.
    // Made nullable because OAuth state generation from BetterAuth does NOT supply a token.
    token: text("token").unique(),
    identifier: text("identifier").notNull(),
    value: text("value"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
