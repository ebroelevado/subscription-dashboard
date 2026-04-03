import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { platforms, plans, subscriptions, clients, clientSubscriptions, renewalLogs, platformRenewals, users, mutationAuditLogs } from "@/db/schema";
import type { ImportDataInput } from "@/lib/validations/account";
import { amountToCents } from "@/lib/currency";
import { deleteR2Folder } from "@/lib/r2";

// ──────────────────────────────────────────
// Export — collects ALL user data into a
// portable JSON blob, ready for download.
// ──────────────────────────────────────────

export async function exportUserData(userId: string) {
  const [
    userRow,
    platformsList,
    plansList,
    subscriptionsList,
    clientsList,
    clientSubscriptionsList,
    renewalLogsList,
    platformRenewalsList,
    auditLogsList,
  ] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
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
    db.select().from(mutationAuditLogs).where(eq(mutationAuditLogs.userId, userId)),
  ]);

  // Strip userId from all records — the importing user gets their own
  const stripUser = <T extends Record<string, unknown>>(rows: T[]) =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rows.map(({ userId: _uid, ...rest }) => rest);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    userSettings: userRow ? {
      currency: userRow.currency,
      disciplinePenalty: userRow.disciplinePenalty,
      companyName: userRow.companyName,
      whatsappSignatureMode: userRow.whatsappSignatureMode,
    } : undefined,
    platforms: stripUser(platformsList),
    plans: stripUser(plansList),
    subscriptions: stripUser(subscriptionsList),
    clients: stripUser(clientsList),
    clientSubscriptions: clientSubscriptionsList.map(r => r.client_subscriptions),
    renewalLogs: renewalLogsList.map(r => r.renewalLogs),
    platformRenewals: platformRenewalsList.map(r => r.platformRenewals),
    mutationAuditLogs: stripUser(auditLogsList),
  };
}

// ──────────────────────────────────────────
// Import — atomic insert of a full data dump
// into the current user's account.
// Clears existing data first to avoid duplicates.
// ──────────────────────────────────────────

export async function importUserData(
  userId: string,
  data: ImportDataInput,
) {
  await db.transaction(async (tx) => {
    // ── Pre-import cleanup: delete existing data in reverse FK order ──
    const existingSubIds = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.userId, userId));
    const existingClientIds = await tx.select({ id: clients.id }).from(clients).where(eq(clients.userId, userId));
    const existingSubIdsList = existingSubIds.map(s => s.id);
    const existingClientIdsList = existingClientIds.map(c => c.id);

    if (existingSubIdsList.length > 0) {
      await tx.delete(platformRenewals).where(inArray(platformRenewals.subscriptionId, existingSubIdsList));
    }
    if (existingClientIdsList.length > 0) {
      const existingClientSubIds = await tx.select({ id: clientSubscriptions.id })
        .from(clientSubscriptions)
        .where(inArray(clientSubscriptions.clientId, existingClientIdsList));
      const existingClientSubIdsList = existingClientSubIds.map(cs => cs.id);
      if (existingClientSubIdsList.length > 0) {
        await tx.delete(renewalLogs).where(inArray(renewalLogs.clientSubscriptionId, existingClientSubIdsList));
        await tx.delete(clientSubscriptions).where(inArray(clientSubscriptions.clientId, existingClientIdsList));
      }
      // Also delete clientSubscriptions linked to user's subscriptions
      if (existingSubIdsList.length > 0) {
        const csForSubs = await tx.select({ id: clientSubscriptions.id })
          .from(clientSubscriptions)
          .where(inArray(clientSubscriptions.subscriptionId, existingSubIdsList));
        const csForSubsList = csForSubs.map(cs => cs.id);
        if (csForSubsList.length > 0) {
          await tx.delete(renewalLogs).where(inArray(renewalLogs.clientSubscriptionId, csForSubsList));
        }
        await tx.delete(clientSubscriptions).where(inArray(clientSubscriptions.subscriptionId, existingSubIdsList));
      }
      await tx.delete(clients).where(eq(clients.userId, userId));
    }

    if (existingSubIdsList.length > 0) {
      await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
    }
    await tx.delete(plans).where(eq(plans.userId, userId));
    await tx.delete(platforms).where(eq(platforms.userId, userId));
    await tx.delete(mutationAuditLogs).where(eq(mutationAuditLogs.userId, userId));

    // ── Update user settings if provided ──
    if (data.userSettings) {
      const settings: Record<string, unknown> = {};
      if (data.userSettings.currency) settings.currency = data.userSettings.currency;
      if (data.userSettings.disciplinePenalty !== undefined) settings.disciplinePenalty = data.userSettings.disciplinePenalty;
      if (data.userSettings.companyName !== undefined) settings.companyName = data.userSettings.companyName;
      if (data.userSettings.whatsappSignatureMode) settings.whatsappSignatureMode = data.userSettings.whatsappSignatureMode;
      if (Object.keys(settings).length > 0) {
        await tx.update(users).set(settings).where(eq(users.id, userId));
      }
    }

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
        masterUsername: s.masterUsername ?? null,
        masterPassword: s.masterPassword ?? null,
        ownerId: s.ownerId ?? null,
        isAutopayable: s.isAutopayable ?? true,
        defaultPaymentNote: s.defaultPaymentNote ?? null,
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
        dailyPenalty: c.dailyPenalty ?? null,
        daysOverdue: c.daysOverdue ?? 0,
        disciplineScore: c.disciplineScore ?? null,
        healthStatus: c.healthStatus ?? null,
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
        notes: (pr as any).notes ?? null,
        ...(pr.createdAt && { createdAt: new Date(pr.createdAt).toISOString() }),
      });
    }

    // 8 · Mutation Audit Logs (optional)
    if (data.mutationAuditLogs && data.mutationAuditLogs.length > 0) {
      for (const al of data.mutationAuditLogs) {
        await tx.insert(mutationAuditLogs).values({
          id: crypto.randomUUID(),
          userId,
          toolName: al.toolName,
          targetId: al.targetId ?? null,
          action: al.action,
          previousValues: al.previousValues ?? null,
          newValues: al.newValues ?? null,
          undone: al.undone ?? false,
          token: al.token,
          expiresAt: al.expiresAt,
          executedAt: al.executedAt ?? null,
          ...(al.createdAt && { createdAt: new Date(al.createdAt).toISOString() }),
        });
      }
    }
  });
}

// ──────────────────────────────────────────
// Delete — removes User row; all children
// cascade-delete via onDelete: Cascade.
// Also deletes R2 conversation storage.
// ──────────────────────────────────────────

export async function deleteUserAccount(userId: string) {
  // Delete R2 conversations first
  try {
    await deleteR2Folder(userId);
  } catch (err) {
    // Log but don't block account deletion if R2 fails
    console.error("[Delete Account] Failed to delete R2 conversations:", err);
  }

  await db.delete(users).where(eq(users.id, userId));
}
