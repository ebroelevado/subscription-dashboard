import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platforms, plans, subscriptions, clients, clientSubscriptions, renewalLogs, platformRenewals, users } from "@/db/schema";
import type { ImportDataInput } from "@/lib/validations/account";
import { amountToCents } from "@/lib/currency";

// ──────────────────────────────────────────
// Export — collects ALL user data into a
// portable JSON blob, ready for download.
// ──────────────────────────────────────────

export async function exportUserData(userId: string) {
  const [
    platformsList,
    plansList,
    subscriptionsList,
    clientsList,
    clientSubscriptionsList,
    renewalLogsList,
    platformRenewalsList,
  ] = await Promise.all([
    db.select().from(platforms).where(eq(platforms.userId, userId)),
    db.select().from(plans).where(eq(plans.userId, userId)),
    db.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
    db.select().from(clients).where(eq(clients.userId, userId)),
    db.select().from(clientSubscriptions)
      .innerJoin(clients, eq(clientSubscriptions.clientId, clients.id))
      .where(eq(clients.userId, userId)),
    db.select({ renewalLogs: renewalLogs })
      .from(renewalLogs)
      .innerJoin(clientSubscriptions, eq(renewalLogs.clientSubscriptionId, clientSubscriptions.id))
      .innerJoin(clients, eq(clientSubscriptions.clientId, clients.id))
      .where(eq(clients.userId, userId)),
    db.select({ platformRenewals: platformRenewals })
      .from(platformRenewals)
      .innerJoin(subscriptions, eq(platformRenewals.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.userId, userId)),
  ]);

  // Strip userId from all records — the importing user gets their own
  const stripUser = <T extends Record<string, unknown>>(rows: T[]) =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rows.map(({ userId: _uid, ...rest }) => rest);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    platforms: stripUser(platformsList),
    plans: stripUser(plansList),
    subscriptions: stripUser(subscriptionsList),
    clients: stripUser(clientsList),
    clientSubscriptions: clientSubscriptionsList.map(r => r.client_subscriptions),
    renewalLogs: renewalLogsList.map(r => r.renewalLogs),
    platformRenewals: platformRenewalsList.map(r => r.platformRenewals),
  };
}

// ──────────────────────────────────────────
// Import — atomic insert of a full data dump
// into the current user's account.
// ──────────────────────────────────────────

export async function importUserData(
  userId: string,
  data: ImportDataInput,
) {
  await db.transaction(async (tx) => {
    // ── ID mappings: old → new ──
    const platformMap = new Map<string, string>();
    const planMap = new Map<string, string>();
    const subscriptionMap = new Map<string, string>();
    const clientMap = new Map<string, string>();
    const clientSubMap = new Map<string, string>();

    // 1 · Platforms
    for (const p of data.platforms) {
      const newId = crypto.randomUUID();
      platformMap.set(p.id, newId);
      await tx.insert(platforms).values({
        id: newId,
        userId,
        name: p.name,
        ...(p.createdAt && { createdAt: new Date(p.createdAt).toISOString() }),
      });
    }

    // 2 · Plans
    for (const p of data.plans) {
      const newId = crypto.randomUUID();
      planMap.set(p.id, newId);
      const platformId = platformMap.get(p.platformId);
      if (!platformId) continue; // skip orphan
      await tx.insert(plans).values({
        id: newId,
        userId,
        platformId,
        name: p.name,
        cost: amountToCents(p.cost),
        maxSeats: p.maxSeats ?? null,
        isActive: p.isActive ?? true,
        ...(p.createdAt && { createdAt: new Date(p.createdAt).toISOString() }),
      });
    }

    // 3 · Subscriptions
    for (const s of data.subscriptions) {
      const newId = crypto.randomUUID();
      subscriptionMap.set(s.id, newId);
      const planId = planMap.get(s.planId);
      if (!planId) continue;
      await tx.insert(subscriptions).values({
        id: newId,
        userId,
        planId,
        label: s.label,
        startDate: new Date(s.startDate).toISOString().split("T")[0],
        activeUntil: new Date(s.activeUntil).toISOString().split("T")[0],
        status: s.status,
        ...(s.createdAt && { createdAt: new Date(s.createdAt).toISOString() }),
      });
    }

    // 4 · Clients
    for (const c of data.clients) {
      const newId = crypto.randomUUID();
      clientMap.set(c.id, newId);
      await tx.insert(clients).values({
        id: newId,
        userId,
        name: c.name,
        phone: c.phone ?? null,
        notes: c.notes ?? null,
        ...(c.createdAt && { createdAt: new Date(c.createdAt).toISOString() }),
      });
    }

    // 5 · Client Subscriptions
    for (const cs of data.clientSubscriptions) {
      const newId = crypto.randomUUID();
      clientSubMap.set(cs.id, newId);
      const clientId = clientMap.get(cs.clientId);
      const subscriptionId = subscriptionMap.get(cs.subscriptionId);
      if (!clientId || !subscriptionId) continue;
      await tx.insert(clientSubscriptions).values({
        id: newId,
        clientId,
        subscriptionId,
        customPrice: amountToCents(cs.customPrice),
        activeUntil: new Date(cs.activeUntil).toISOString().split("T")[0],
        joinedAt: new Date(cs.joinedAt).toISOString().split("T")[0],
        leftAt: cs.leftAt ? new Date(cs.leftAt).toISOString().split("T")[0] : null,
        status: cs.status,
        remainingDays: cs.remainingDays ?? null,
        serviceUser: (cs as any).serviceUser ?? null,
        servicePassword: (cs as any).servicePassword ?? null,
      });
    }

    // 6 · Renewal Logs (append-only — import as new entries)
    for (const rl of data.renewalLogs) {
      const clientSubscriptionId = clientSubMap.get(rl.clientSubscriptionId);
      if (!clientSubscriptionId) continue;
      await tx.insert(renewalLogs).values({
        id: crypto.randomUUID(),
        clientSubscriptionId,
        amountPaid: amountToCents(rl.amountPaid),
        expectedAmount: amountToCents(rl.expectedAmount),
        periodStart: new Date(rl.periodStart).toISOString().split("T")[0],
        periodEnd: new Date(rl.periodEnd).toISOString().split("T")[0],
        paidOn: new Date(rl.paidOn).toISOString().split("T")[0],
        dueOn: new Date(rl.dueOn).toISOString().split("T")[0],
        monthsRenewed: rl.monthsRenewed,
        notes: rl.notes ?? null,
        ...(rl.createdAt && { createdAt: new Date(rl.createdAt).toISOString() }),
      });
    }

    // 7 · Platform Renewals
    for (const pr of data.platformRenewals) {
      const subscriptionId = subscriptionMap.get(pr.subscriptionId);
      if (!subscriptionId) continue;
      await tx.insert(platformRenewals).values({
        id: crypto.randomUUID(),
        subscriptionId,
        amountPaid: amountToCents(pr.amountPaid),
        periodStart: new Date(pr.periodStart).toISOString().split("T")[0],
        periodEnd: new Date(pr.periodEnd).toISOString().split("T")[0],
        paidOn: new Date(pr.paidOn).toISOString().split("T")[0],
        ...(pr.createdAt && { createdAt: new Date(pr.createdAt).toISOString() }),
      });
    }
  });
}

// ──────────────────────────────────────────
// Delete — removes User row; all children
// cascade-delete via onDelete: Cascade.
// ──────────────────────────────────────────

export async function deleteUserAccount(userId: string) {
  await db.delete(users).where(eq(users.id, userId));
}
