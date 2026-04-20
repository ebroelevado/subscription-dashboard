import {
  sqliteTable,
  text,
  real,
  integer,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { userPlanValues } from "./enums";
import { relations } from "drizzle-orm";
import { accounts } from "./accounts";
import { sessions } from "./sessions";
import { platforms } from "./platforms";
import { plans } from "./plans";
import { subscriptions } from "./subscriptions";
import { clients } from "./clients";
import { mutationAuditLogs } from "./mutation-audit-logs";
import { agentRuns } from "./agent-runs";

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "number" }).default(0),
  password: text("password"),
  image: text("image"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  currency: text("currency").default("EUR").notNull(),
  disciplinePenalty: real("discipline_penalty").default(0.5).notNull(),
  usageCredits: real("usage_credits").default(0).notNull(),
  companyName: text("company_name"),
  whatsappSignatureMode: text("whatsapp_signature_mode")
    .default("name")
    .notNull(),
  plan: text("plan", { enum: userPlanValues }).default("FREE").notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripePriceId: text("stripe_price_id"),
  stripeCurrentPeriodEnd: text("stripe_current_period_end"),
});

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  platforms: many(platforms),
  plans: many(plans),
  subscriptions: many(subscriptions),
  clients: many(clients),
  mutationAuditLogs: many(mutationAuditLogs),
  agentRuns: many(agentRuns),
}));
