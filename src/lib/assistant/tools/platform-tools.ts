import { z } from "zod";
import { eq, and, desc, asc, count, sql, sum, gte, lte, inArray, or, like, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users, clients, clientSubscriptions, subscriptions, plans, platforms, renewalLogs, platformRenewals, mutationAuditLogs } from "@/db/schema";
import { getDisciplineAnalytics } from "@/lib/discipline-service";
import { serializeDeletedClients } from "@/lib/client-deletion-snapshot";
import { createMutationToken } from "@/lib/mutation-token";
import { jsonToCsv } from "@/lib/csv-utils";
import { formatCurrency, centsToAmount } from "@/lib/currency";
import { preparePythonAnalysis as preparePython, pythonAnalysisTemplateIds } from "@/lib/python-analysis";

type DefineToolFn = (...args: any[]) => any;

export function getPlatformTools(defineTool: DefineToolFn, userId: string, allowDestructive: boolean = false) {
  const tools = [];

  tools.push(
    defineTool("listPlatforms", {
          description:
            "List all platforms (Netflix, Spotify, etc.) with their plans, number of active subscriptions, total seats, and costs.",
          parameters: z.object({}),
          handler: async () => {
            const platformsList = await db.query.platforms.findMany({
              where: eq(platforms.userId, userId),
              orderBy: [asc(platforms.name)],
              with: {
                plans: {
                  with: {
                    subscriptions: {
                      with: {
                        clientSubscriptions: {
                          columns: { id: true, status: true },
                        },
                      },
                    },
                  },
                },
              },
            });
    
            return platformsList.map((p) => ({
              id: p.id,
              name: p.name,
              plans: p.plans.map((plan) => ({
                id: plan.id,
                name: plan.name,
                costPerMonth: Number(plan.cost),
                maxSeats: plan.maxSeats,
                isActive: plan.isActive,
                subscriptions: plan.subscriptions.map((sub) => ({
                  id: sub.id,
                  label: sub.label,
                  status: sub.status,
                  activeUntil: sub.activeUntil,
                  seatsUsed: sub.clientSubscriptions.filter(cs => cs.status === "active").length,
                })),
              })),
            }));
          },
        }),
    
  );

  tools.push(
    defineTool("listPlatformRenewals", {
          description:
            "List recent platform renewal payments (what YOU pay to providers like Netflix, Spotify, etc.). Optionally filter by platform name or date range.",
          parameters: z.object({
            platformName: z
              .string()
              .describe("Filter by platform name")
              .optional(),
            fromDate: z
              .string()
              .describe("Start date (ISO format)")
              .optional(),
            toDate: z
              .string()
              .describe("End date (ISO format)")
              .optional(),
            limit: z.number().describe("Max results (default 20)").optional(),
          }),
          handler: async ({
            platformName,
            fromDate,
            toDate,
            limit = 20,
          }: {
            platformName?: string;
            fromDate?: string;
            toDate?: string;
            limit?: number;
          }) => {
            // Build conditions
            const conditions = [];
    
            // Filter by userId through subscription
            const userSubs = await db.select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.userId, userId));
            const userSubIds = userSubs.map(s => s.id);
            if (userSubIds.length === 0) return { totalFound: 0, renewals: [] };
            conditions.push(inArray(platformRenewals.subscriptionId, userSubIds));
    
            // Filter by platform name
            if (platformName) {
              const matchedPlatforms = await db.select({ id: platforms.id })
                .from(platforms)
                .where(like(sql`lower(${platforms.name})`, `%${platformName.toLowerCase()}%`));
              const platIds = matchedPlatforms.map(p => p.id);
              if (platIds.length === 0) return { totalFound: 0, renewals: [] };
              const matchedSubs = await db.select({ id: subscriptions.id })
                .from(subscriptions)
                .innerJoin(plans, eq(subscriptions.planId, plans.id))
                .where(inArray(plans.platformId, platIds));
              const subIds = matchedSubs.map(s => s.id);
              conditions.push(inArray(platformRenewals.subscriptionId, subIds));
            }
    
            // Date filters
            if (fromDate) conditions.push(gte(platformRenewals.paidOn, fromDate));
            if (toDate) conditions.push(lte(platformRenewals.paidOn, toDate));
    
            const renewals = await db.query.platformRenewals.findMany({
              where: and(...conditions),
              orderBy: [desc(platformRenewals.paidOn)],
              limit: Math.min(limit, 100),
              with: {
                subscription: {
                  columns: { label: true },
                  with: {
                    plan: {
                      columns: { name: true },
                      with: { platform: { columns: { name: true } } }
                    }
                  },
                },
              },
            });
    
            return {
              totalFound: renewals.length,
              renewals: renewals.map((pr) => ({
                id: pr.id,
                platform: pr.subscription.plan.platform.name,
                plan: pr.subscription.plan.name,
                subscription: pr.subscription.label,
                amountPaid: Number(pr.amountPaid),
                periodStart: pr.periodStart,
                periodEnd: pr.periodEnd,
                paidOn: pr.paidOn,
              })),
            };
          },
        }),
    
  );

  if (allowDestructive) {
    tools.push(
      defineTool("managePlatforms", {
            description: "Creates, updates, or bulk-deletes platforms based on the provided operation.",
            parameters: z.object({
              operation: z.enum(["create", "update", "delete"]),
              platformIds: z.array(z.string()).optional().describe("For 'delete', provide array of platform IDs. For 'update', provide exactly 1 ID."),
              name: z.string().optional().describe("For 'create' or 'update'."),
            }),
            handler: async ({ operation, platformIds, name }: any) => {
              // Guard: prevent creating a duplicate platform name
              if (operation === "create" && name) {
                const existing = await db.query.platforms.findFirst({
                  where: and(
                    eq(platforms.userId, userId),
                    like(sql`lower(${platforms.name})`, name.toLowerCase())
                  )
                });
                if (existing) {
                  return { error: `A platform named "${existing.name}" already exists (ID: ${existing.id}). Use operation "update" to modify it, or choose a different name.` };
                }
              }
      
              const pendingChanges = { operation, platformIds, name };
              // Get previous state if updating/deleting
              let previousValues: any = null;
              if (operation === "delete" && platformIds) {
                  const platformsList = await db.query.platforms.findMany({
                    where: and(inArray(platforms.id, platformIds), eq(platforms.userId, userId))
                  });
                  if (!platformsList.length) return { error: "Platform(s) not found or access denied." };
                  previousValues = platformsList.map(p => ({ id: p.id, name: p.name }));
              } else if (operation === "update" && platformIds && platformIds[0]) {
                  const p = await db.query.platforms.findFirst({
                    where: and(eq(platforms.id, platformIds[0]), eq(platforms.userId, userId))
                  });
                  if (!p) return { error: "Platform not found or access denied." };
                  previousValues = [{ id: p.id, name: p.name }];
              }
      
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "managePlatforms", action: operation as any, changes: pendingChanges, previousValues });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to ${operation} platform(s).`, pendingChanges };
            },
          }),
      
    );
    tools.push(
      defineTool("managePlans", {
            description: "Creates, updates, or bulk-deletes plans.",
            parameters: z.object({
              operation: z.enum(["create", "update", "delete"]),
              planIds: z.array(z.string()).optional().describe("For 'delete' array, for 'update' single ID."),
              platformId: z.string().optional().describe("For 'create'"),
              name: z.string().optional(),
              cost: z.number().optional(),
              maxSeats: z.number().optional(),
              isActive: z.boolean().optional(),
            }),
            handler: async ({ operation, planIds, platformId, name, cost, maxSeats, isActive }: any) => {
              // Guard: prevent duplicate plan name within same platform
              if (operation === "create" && platformId && name) {
                const existingPlan = await db.query.plans.findFirst({
                  where: and(
                    eq(plans.platformId, platformId),
                    eq(plans.userId, userId),
                    like(sql`lower(${plans.name})`, name.toLowerCase())
                  )
                });
                if (existingPlan) {
                  return { error: `A plan named "${existingPlan.name}" already exists in this platform (ID: ${existingPlan.id}). Use operation "update" to modify it, or choose a different name.` };
                }
              }
      
              const pendingChanges = { operation, planIds, platformId, name, cost, maxSeats, isActive };
              let previousValues: any = null;
              if (operation === "delete" && planIds) {
                  const plansList = await db.query.plans.findMany({
                    where: and(inArray(plans.id, planIds), eq(plans.userId, userId))
                  });
                  if (!plansList.length) return { error: "Plan(s) not found or access denied." };
                  previousValues = plansList;
              } else if (operation === "update" && planIds && planIds[0]) {
                  const p = await db.query.plans.findFirst({
                    where: and(eq(plans.id, planIds[0]), eq(plans.userId, userId))
                  });
                  if (!p) return { error: "Plan not found or access denied." };
                  previousValues = [p];
              }
              const { token, expiresAt } = await createMutationToken(userId, { toolName: "managePlans", action: operation as any, changes: pendingChanges, previousValues });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: `I am ready to ${operation} plan(s).`, pendingChanges };
            },
          }),
      
    );
  }
  return tools;
}
