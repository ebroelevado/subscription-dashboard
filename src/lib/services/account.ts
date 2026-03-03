import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import type { ImportDataInput } from "@/lib/validations/account";

// ──────────────────────────────────────────
// Export — collects ALL user data into a
// portable JSON blob, ready for download.
// ──────────────────────────────────────────

export async function exportUserData(userId: string) {
  const [
    platforms,
    plans,
    subscriptions,
    clients,
    clientSubscriptions,
    renewalLogs,
    platformRenewals,
  ] = await Promise.all([
    prisma.platform.findMany({ where: { userId } }),
    prisma.plan.findMany({ where: { userId } }),
    prisma.subscription.findMany({ where: { userId } }),
    prisma.client.findMany({ where: { userId } }),
    prisma.clientSubscription.findMany({
      where: { client: { userId } },
    }),
    prisma.renewalLog.findMany({
      where: { clientSubscription: { client: { userId } } },
    }),
    prisma.platformRenewal.findMany({
      where: { subscription: { userId } },
    }),
  ]);

  // Strip userId from all records — the importing user gets their own
  const stripUser = <T extends Record<string, unknown>>(rows: T[]) =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rows.map(({ userId: _uid, ...rest }) => rest);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    platforms: stripUser(platforms),
    plans: stripUser(plans),
    subscriptions: stripUser(subscriptions),
    clients: stripUser(clients),
    clientSubscriptions: clientSubscriptions, // no userId field
    renewalLogs: renewalLogs, // no userId field
    platformRenewals: platformRenewals, // no userId field
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
  await prisma.$transaction(async (tx) => {
    // ── ID mappings: old → new ──
    const platformMap = new Map<string, string>();
    const planMap = new Map<string, string>();
    const subscriptionMap = new Map<string, string>();
    const clientMap = new Map<string, string>();
    const clientSubMap = new Map<string, string>();

    // 1 · Platforms
    for (const p of data.platforms) {
      const newId = randomUUID();
      platformMap.set(p.id, newId);
      await tx.platform.create({
        data: {
          id: newId,
          userId,
          name: p.name,
          ...(p.createdAt && { createdAt: new Date(p.createdAt) }),
        },
      });
    }

    // 2 · Plans
    for (const p of data.plans) {
      const newId = randomUUID();
      planMap.set(p.id, newId);
      const platformId = platformMap.get(p.platformId);
      if (!platformId) continue; // skip orphan
      await tx.plan.create({
        data: {
          id: newId,
          userId,
          platformId,
          name: p.name,
          cost: p.cost,
          maxSeats: p.maxSeats ?? null,
          isActive: p.isActive ?? true,
          ...(p.createdAt && { createdAt: new Date(p.createdAt) }),
        },
      });
    }

    // 3 · Subscriptions
    for (const s of data.subscriptions) {
      const newId = randomUUID();
      subscriptionMap.set(s.id, newId);
      const planId = planMap.get(s.planId);
      if (!planId) continue;
      await tx.subscription.create({
        data: {
          id: newId,
          userId,
          planId,
          label: s.label,
          startDate: new Date(s.startDate),
          activeUntil: new Date(s.activeUntil),
          status: s.status,
          ...(s.createdAt && { createdAt: new Date(s.createdAt) }),
        },
      });
    }

    // 4 · Clients
    for (const c of data.clients) {
      const newId = randomUUID();
      clientMap.set(c.id, newId);
      await tx.client.create({
        data: {
          id: newId,
          userId,
          name: c.name,
          phone: c.phone ?? null,
          notes: c.notes ?? null,
          ...(c.createdAt && { createdAt: new Date(c.createdAt) }),
        },
      });
    }

    // 5 · Client Subscriptions
    for (const cs of data.clientSubscriptions) {
      const newId = randomUUID();
      clientSubMap.set(cs.id, newId);
      const clientId = clientMap.get(cs.clientId);
      const subscriptionId = subscriptionMap.get(cs.subscriptionId);
      if (!clientId || !subscriptionId) continue;
      await tx.clientSubscription.create({
        data: {
          id: newId,
          clientId,
          subscriptionId,
          customPrice: cs.customPrice,
          activeUntil: new Date(cs.activeUntil),
          joinedAt: new Date(cs.joinedAt),
          leftAt: cs.leftAt ? new Date(cs.leftAt) : null,
          status: cs.status,
          remainingDays: cs.remainingDays ?? null,
          serviceUser: (cs as any).serviceUser ?? null,
          servicePassword: (cs as any).servicePassword ?? null,
        },
      });
    }

    // 6 · Renewal Logs (append-only — import as new entries)
    for (const rl of data.renewalLogs) {
      const clientSubscriptionId = clientSubMap.get(rl.clientSubscriptionId);
      if (!clientSubscriptionId) continue;
      await tx.renewalLog.create({
        data: {
          id: randomUUID(),
          clientSubscriptionId,
          amountPaid: rl.amountPaid,
          expectedAmount: rl.expectedAmount,
          periodStart: new Date(rl.periodStart),
          periodEnd: new Date(rl.periodEnd),
          paidOn: new Date(rl.paidOn),
          dueOn: new Date(rl.dueOn),
          monthsRenewed: rl.monthsRenewed,
          notes: rl.notes ?? null,
          ...(rl.createdAt && { createdAt: new Date(rl.createdAt) }),
        },
      });
    }

    // 7 · Platform Renewals
    for (const pr of data.platformRenewals) {
      const subscriptionId = subscriptionMap.get(pr.subscriptionId);
      if (!subscriptionId) continue;
      await tx.platformRenewal.create({
        data: {
          id: randomUUID(),
          subscriptionId,
          amountPaid: pr.amountPaid,
          periodStart: new Date(pr.periodStart),
          periodEnd: new Date(pr.periodEnd),
          paidOn: new Date(pr.paidOn),
          ...(pr.createdAt && { createdAt: new Date(pr.createdAt) }),
        },
      });
    }
  });
}

// ──────────────────────────────────────────
// Delete — removes User row; all children
// cascade-delete via onDelete: Cascade.
// ──────────────────────────────────────────

export async function deleteUserAccount(userId: string) {
  await prisma.user.delete({ where: { id: userId } });
}
