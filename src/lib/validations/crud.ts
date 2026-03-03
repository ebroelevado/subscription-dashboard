import { z } from "zod";

// ──────────────────────────────────────────
// Platform
// ──────────────────────────────────────────

export const createPlatformSchema = z.object({
  name: z.string().min(1).max(100),
});

export type CreatePlatformInput = z.infer<typeof createPlatformSchema>;

// ──────────────────────────────────────────
// Plan
// ──────────────────────────────────────────

export const createPlanSchema = z.object({
  platformId: z.string().uuid(),
  name: z.string().min(1).max(100),
  cost: z.number().min(0),
  maxSeats: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

// ──────────────────────────────────────────
// Subscription
// ──────────────────────────────────────────

export const createSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  label: z.string().min(1).max(100),
  startDate: z.string().date().transform((val) => new Date(val)),
  durationMonths: z.coerce.number().int().positive(),
  status: z.enum(["active", "paused"]).optional().default("active"),
  masterUsername: z.string().max(100).nullable().optional(),
  masterPassword: z.string().max(100).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  isAutopayable: z.boolean().optional().default(true),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

// ──────────────────────────────────────────
// Client
// ──────────────────────────────────────────

export const createClientSchema = z.object({
  name: z.string().min(1).max(150),
  phone: z.string().max(30).nullable().optional(),
  notes: z.string().nullable().optional(),
  serviceUser: z.string().max(100).nullable().optional(),
  servicePassword: z.string().max(100).nullable().optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

// ──────────────────────────────────────────
// Client Subscription (Seat Assignment)
// ──────────────────────────────────────────

export const createClientSubscriptionSchema = z.object({
  clientId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  customPrice: z.number().min(0),
  durationMonths: z.coerce.number().int().positive(),
  serviceUser: z.string().max(100).nullable().optional(),
  servicePassword: z.string().max(100).nullable().optional(),
  startDate: z.string().date().transform((val) => new Date(val)).optional(),
  status: z
    .enum(["active", "paused"])
    .optional()
    .default("active"),
});

export type CreateClientSubscriptionInput = z.infer<
  typeof createClientSubscriptionSchema
>;

// ──────────────────────────────────────────
// Renew Client Subscription
// ──────────────────────────────────────────

export const renewClientSubscriptionSchema = z.object({
  amountPaid: z.number().optional(), // defaults to custom_price; can be 0 for corrections
  months: z.coerce.number().int().refine((v) => v !== 0, { message: "Months cannot be zero" }).optional().default(1),
  notes: z.string().nullable().optional(),
});

export type RenewClientSubscriptionInput = z.infer<
  typeof renewClientSubscriptionSchema
>;

// ──────────────────────────────────────────
// Bulk Renew Client Subscriptions
// ──────────────────────────────────────────

export const renewBulkClientSubscriptionsSchema = z.object({
  items: z
    .array(
      z.object({
        clientSubscriptionId: z.string().uuid(),
        amountPaid: z.number().min(0).optional(),
      })
    )
    .min(1, "Select at least one service to renew"),
  months: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .default(1),
});

export type RenewBulkClientSubscriptionsInput = z.infer<
  typeof renewBulkClientSubscriptionsSchema
>;

// ──────────────────────────────────────────
// Renew Platform Subscription
// ──────────────────────────────────────────

export const renewPlatformSubscriptionSchema = z.object({
  amountPaid: z.number().min(0).optional(), // defaults to plan cost
  notes: z.string().nullable().optional(),
});

export type RenewPlatformSubscriptionInput = z.infer<
  typeof renewPlatformSubscriptionSchema
>;

// ──────────────────────────────────────────
// Update Seat (Pause / Resume / Cancel)
// ──────────────────────────────────────────

export const updateSeatSchema = z.object({
  status: z.enum(["active", "paused"]).optional(),
  customPrice: z.number().min(0).optional(),
  durationMonths: z.coerce.number().int().positive().optional(), // only for reactivation
  startDate: z.string().date().transform((val) => new Date(val)).optional(),
  activeUntil: z.string().date().transform((val) => new Date(val)).optional(),
  serviceUser: z.string().max(100).nullable().optional(),
  servicePassword: z.string().max(100).nullable().optional(),
});

export type UpdateSeatInput = z.infer<typeof updateSeatSchema>;
