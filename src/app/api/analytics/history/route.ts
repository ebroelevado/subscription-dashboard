import { eq, and, desc, count, sql, gte, lte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  renewalLogs,
  clientSubscriptions,
  subscriptions,
  platformRenewals,
  clients,
  plans,
  platforms,
} from "@/db/schema";
import { success, withErrorHandling } from "@/lib/api-utils";
import { NextRequest } from "next/server";

interface UnifiedRow {
  id: string;
  type: "income" | "cost";
  amount: number;
  paidOn: string;
  periodStart: string;
  periodEnd: string;
  platformId: string | null;
  platform: string;
  planId: string | null;
  plan: string;
  subscriptionLabel: string;
  subscriptionId: string;
  clientSubscriptionId: string | null;
  clientId: string | null;
  clientName: string | null;
  notes: string | null;
}

// GET /api/analytics/history — Paginated unified transaction ledger
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") ?? 20)));
    const type = params.get("type") ?? "all"; // income | cost | all
    const platformId = params.get("platformId") ?? undefined;
    const planId = params.get("planId") ?? undefined;
    const subscriptionId = params.get("subscriptionId") ?? undefined;
    const clientId = params.get("clientId") ?? undefined;
    const dateFrom = params.get("dateFrom") ?? undefined;
    const dateTo = params.get("dateTo") ?? undefined;

    // --- Income rows ---
    let incomeRows: UnifiedRow[] = [];
    let incomeCount = 0;

    if (type === "all" || type === "income") {
      // Build where conditions for renewalLogs
      const conditions = [eq(subscriptions.userId, userId)];

      if (subscriptionId) conditions.push(eq(subscriptions.id, subscriptionId));
      if (planId) conditions.push(eq(subscriptions.planId, planId));
      if (platformId) conditions.push(eq(plans.platformId, platformId));
      if (clientId) conditions.push(eq(clientSubscriptions.clientId, clientId));
      if (dateFrom) conditions.push(gte(renewalLogs.paidOn, dateFrom));
      if (dateTo) conditions.push(lte(renewalLogs.paidOn, dateTo));

      const [logs, cnt] = await Promise.all([
        db
          .select({
            id: sql<string>`${renewalLogs.id}`.as("renewal_log_id"),
            amountPaid: renewalLogs.amountPaid,
            paidOn: renewalLogs.paidOn,
            periodStart: renewalLogs.periodStart,
            periodEnd: renewalLogs.periodEnd,
            notes: renewalLogs.notes,
            platformId: sql<string>`${platforms.id}`.as("platform_id"),
            platformName: sql<string>`${platforms.name}`.as("platform_name"),
            planId: sql<string>`${plans.id}`.as("plan_id"),
            planName: sql<string>`${plans.name}`.as("plan_name"),
            subscriptionLabel: sql<string>`${subscriptions.label}`.as("subscription_label"),
            subscriptionId: sql<string>`${subscriptions.id}`.as("subscription_id"),
            clientSubscriptionId: sql<string>`${clientSubscriptions.id}`.as("client_subscription_id"),
            clientId: sql<string>`${clients.id}`.as("client_id"),
            clientName: sql<string>`${clients.name}`.as("client_name"),
          })
          .from(renewalLogs)
          .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .innerJoin(clients, eq(clientSubscriptions.clientId, clients.id))
          .leftJoin(plans, eq(subscriptions.planId, plans.id))
          .leftJoin(platforms, eq(plans.platformId, platforms.id))
          .where(and(...conditions))
          .orderBy(desc(renewalLogs.paidOn)),
        db
          .select({ total: sql<number>`COUNT(*)` })
          .from(renewalLogs)
          .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
          .innerJoin(subscriptions, eq(clientSubscriptions.subscriptionId, subscriptions.id))
          .leftJoin(plans, eq(subscriptions.planId, plans.id))
          .where(and(...conditions)),
      ]);

      incomeRows = logs.map((l: any) => ({
        id: l.id,
        type: "income" as const,
        amount: Number(l.amountPaid),
        paidOn: l.paidOn,
        periodStart: l.periodStart,
        periodEnd: l.periodEnd,
        platformId: l.platformId ?? null,
        platform: l.platformName ?? "Deleted",
        planId: l.planId ?? null,
        plan: l.planName ?? "Deleted",
        subscriptionLabel: l.subscriptionLabel ?? "Deleted",
        subscriptionId: l.subscriptionId ?? "deleted",
        clientSubscriptionId: l.clientSubscriptionId ?? null,
        clientId: l.clientId ?? null,
        clientName: l.clientName ?? "Deleted Client",
        notes: l.notes,
      }));
      incomeCount = Number(cnt[0]?.total ?? 0);
    }

    // --- Cost rows ---
    let costRows: UnifiedRow[] = [];
    let costCount = 0;

    if ((type === "all" || type === "cost") && !clientId) {
      const conditions = [eq(subscriptions.userId, userId)];

      if (subscriptionId) conditions.push(eq(subscriptions.id, subscriptionId));
      if (planId) conditions.push(eq(subscriptions.planId, planId));
      if (platformId) conditions.push(eq(plans.platformId, platformId));
      if (dateFrom) conditions.push(gte(platformRenewals.paidOn, dateFrom));
      if (dateTo) conditions.push(lte(platformRenewals.paidOn, dateTo));

      const [renewals, cnt] = await Promise.all([
        db
          .select({
            id: sql<string>`${platformRenewals.id}`.as("platform_renewal_id"),
            amountPaid: platformRenewals.amountPaid,
            paidOn: platformRenewals.paidOn,
            periodStart: platformRenewals.periodStart,
            periodEnd: platformRenewals.periodEnd,
            notes: platformRenewals.notes,
            platformId: sql<string>`${platforms.id}`.as("platform_id"),
            platformName: sql<string>`${platforms.name}`.as("platform_name"),
            planId: sql<string>`${plans.id}`.as("plan_id"),
            planName: sql<string>`${plans.name}`.as("plan_name"),
            subscriptionLabel: sql<string>`${subscriptions.label}`.as("subscription_label"),
            subscriptionId: sql<string>`${subscriptions.id}`.as("subscription_id"),
            ownerClientId: sql<string>`${subscriptions.ownerId}`.as("owner_client_id"),
            ownerClientName: sql<string>`${clients.name}`.as("owner_client_name"),
          })
          .from(platformRenewals)
          .innerJoin(subscriptions, eq(platformRenewals.subscriptionId, subscriptions.id))
          .leftJoin(plans, eq(subscriptions.planId, plans.id))
          .leftJoin(platforms, eq(plans.platformId, platforms.id))
          .leftJoin(clients, eq(subscriptions.ownerId, clients.id))
          .where(and(...conditions))
          .orderBy(desc(platformRenewals.paidOn)),
        db
          .select({ total: sql<number>`COUNT(*)` })
          .from(platformRenewals)
          .innerJoin(subscriptions, eq(platformRenewals.subscriptionId, subscriptions.id))
          .leftJoin(plans, eq(subscriptions.planId, plans.id))
          .where(and(...conditions)),
      ]);

      costRows = renewals.map((r: any) => ({
        id: r.id,
        type: "cost" as const,
        amount: Number(r.amountPaid),
        paidOn: r.paidOn,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        platformId: r.platformId ?? null,
        platform: r.platformName ?? "Deleted",
        planId: r.planId ?? null,
        plan: r.planName ?? "Deleted",
        subscriptionLabel: r.subscriptionLabel ?? "Deleted",
        subscriptionId: r.subscriptionId ?? "deleted",
        clientSubscriptionId: null,
        clientId: r.ownerClientId ?? null,
        clientName: r.ownerClientName ?? "Deleted Client",
        notes: r.notes ?? "platform_payment",
      }));
      costCount = Number(cnt[0]?.total ?? 0);
    }

    // --- Merge + sort + paginate ---
    const allRows = [...incomeRows, ...costRows].sort(
      (a, b) => new Date(b.paidOn).getTime() - new Date(a.paidOn).getTime()
    );

    const totalCount = type === "income" ? incomeCount
      : type === "cost" ? costCount
      : incomeCount + costCount;

    const start = (page - 1) * pageSize;
    const rows = allRows.slice(start, start + pageSize);

    return success({
      rows,
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  });
}
