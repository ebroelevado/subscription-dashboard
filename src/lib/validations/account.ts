import { z } from "zod";

// ──────────────────────────────────────────
// Update Profile
// ──────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  image: z.string().url("Must be a valid URL").nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ──────────────────────────────────────────
// Import Data — strict Zod schema matching
// the export format for all 7 core tables.
// ──────────────────────────────────────────

const platformImportSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  createdAt: z.string().optional(),
});

const planImportSchema = z.object({
  id: z.string(),
  platformId: z.string(),
  name: z.string().min(1).max(100),
  cost: z.number().min(0),
  maxSeats: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  createdAt: z.string().optional(),
});

const subscriptionImportSchema = z.object({
  id: z.string(),
  planId: z.string(),
  label: z.string().min(1).max(100),
  startDate: z.string(),
  activeUntil: z.string(),
  status: z.enum(["active", "paused"]).default("active"),
  createdAt: z.string().optional(),
  masterUsername: z.string().max(200).nullable().optional(),
  masterPassword: z.string().max(500).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  isAutopayable: z.boolean().optional().default(true),
  defaultPaymentNote: z.string().nullable().optional(),
});

const clientImportSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(150),
  phone: z.string().max(30).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  dailyPenalty: z.number().int().nullable().optional(),
  daysOverdue: z.number().int().nullable().optional(),
  disciplineScore: z.string().nullable().optional(),
  healthStatus: z.string().nullable().optional(),
});

const clientSubscriptionImportSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  subscriptionId: z.string(),
  customPrice: z.number().min(0),
  activeUntil: z.string(),
  joinedAt: z.string(),
  leftAt: z.string().nullable().optional(),
  status: z.enum(["active", "paused"]).default("active"),
  remainingDays: z.number().int().nullable().optional(),
  serviceUser: z.string().max(100).nullable().optional(),
  servicePassword: z.string().max(100).nullable().optional(),
});

const renewalLogImportSchema = z.object({
  id: z.string(),
  clientSubscriptionId: z.string(),
  clientId: z.string().optional(),
  subscriptionId: z.string().optional(),
  amountPaid: z.number().min(0),
  expectedAmount: z.number().min(0),
  periodStart: z.string(),
  periodEnd: z.string(),
  paidOn: z.string(),
  dueOn: z.string(),
  monthsRenewed: z.number().int().positive().default(1),
  notes: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

const platformRenewalImportSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  amountPaid: z.number().min(0),
  periodStart: z.string(),
  periodEnd: z.string(),
  paidOn: z.string(),
  createdAt: z.string().optional(),
  notes: z.string().nullable().optional(),
});

const mutationAuditLogImportSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  targetId: z.string().nullable().optional(),
  action: z.string(),
  previousValues: z.unknown().nullable().optional(),
  newValues: z.unknown().nullable().optional(),
  undone: z.boolean().optional().default(false),
  token: z.string(),
  expiresAt: z.string(),
  executedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

const userSettingsImportSchema = z.object({
  currency: z.string().optional(),
  disciplinePenalty: z.number().min(0).optional(),
  companyName: z.string().nullable().optional(),
  whatsappSignatureMode: z.string().optional(),
});

export const importDataSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: z.string(),
  userSettings: userSettingsImportSchema.optional(),
  platforms: z.array(platformImportSchema),
  plans: z.array(planImportSchema),
  subscriptions: z.array(subscriptionImportSchema),
  clients: z.array(clientImportSchema),
  clientSubscriptions: z.array(clientSubscriptionImportSchema),
  renewalLogs: z.array(renewalLogImportSchema),
  platformRenewals: z.array(platformRenewalImportSchema),
  mutationAuditLogs: z.array(mutationAuditLogImportSchema).optional(),
});

export type ImportDataInput = z.infer<typeof importDataSchema>;
