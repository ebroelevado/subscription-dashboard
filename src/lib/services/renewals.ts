import { prisma } from "@/lib/prisma";
import { addMonths, subMonths, addDays, startOfDay } from "date-fns";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ──────────────────────────────────────────
// renewClientSubscription
//
// Implements the "Renew" button logic:
// 1. Read current active_until
// 2. If months > 0:
//    If current >= today → new_expiry = current + N months
//    If current < today  → new_expiry = today + N months (lapsed)
// 3. If months < 0 (correction):
//    new_expiry = current - |N| months (can go into the past)
// 4. INSERT append-only renewal_log
// 5. UPDATE client_subscriptions.active_until
// ──────────────────────────────────────────

interface RenewClientParams {
  clientSubscriptionId: string;
  amountPaid?: number; // defaults to custom_price
  months?: number; // defaults to 1; negative = correction
  notes?: string | null;
}

export async function renewClientSubscription({
  clientSubscriptionId,
  amountPaid,
  months = 1,
  notes = null,
}: RenewClientParams) {
  return prisma.$transaction(async (tx: TxClient) => {
    // 1. Fetch the seat with its current state
    const seat = await tx.clientSubscription.findUniqueOrThrow({
      where: { id: clientSubscriptionId },
    });

    // Seats are now only active or paused (cancelled was removed from schema)

    const today = startOfDay(new Date());
    const currentExpiry = startOfDay(new Date(seat.activeUntil));
    const customPrice = Number(seat.customPrice);

    // 2. Compute new expiry
    let newExpiry: Date;
    if (months > 0) {
      // Normal renewal: always extend from current expiry
      newExpiry = addMonths(currentExpiry, months);
    } else {
      // Negative correction: always subtract from current expiry
      newExpiry = subMonths(currentExpiry, Math.abs(months));
    }

    // 3. Calculate period boundaries
    const periodStart = months > 0 ? addDays(currentExpiry, 1) : newExpiry;
    const periodEnd = months > 0 ? newExpiry : currentExpiry;

    // 4. The amount collected — defaults to custom_price if not specified
    const paid = amountPaid ?? customPrice;

    // 5. Auto-tag correction notes
    const finalNotes =
      months < 0
        ? `[CORRECTION] ${notes ?? `Subtracted ${Math.abs(months)} month(s)`}`
        : notes;

    // 6. INSERT append-only renewal_log (NEVER update or delete these)
    const log = await tx.renewalLog.create({
      data: {
        clientSubscriptionId,
        amountPaid: paid,
        expectedAmount: customPrice,
        periodStart,
        periodEnd,
        paidOn: today,
        dueOn: currentExpiry,
        monthsRenewed: months,
        notes: finalNotes,
      },
    });

    // 7. UPDATE the seat's active_until
    const updatedSeat = await tx.clientSubscription.update({
      where: { id: clientSubscriptionId },
      data: { activeUntil: newExpiry },
    });

    return { seat: updatedSeat, log };
  });
}

// ──────────────────────────────────────────
// renewBulkClientSubscriptions
//
// Renews multiple seats in a single atomic transaction.
// Each seat gets its OWN RenewalLog row (granularity).
// Anchor logic is applied per-seat independently.
// ──────────────────────────────────────────

interface BulkRenewItem {
  clientSubscriptionId: string;
  amountPaid?: number; // defaults to custom_price * months
  months?: number;     // per-item override; falls back to global
  notes?: string | null;
}

interface BulkRenewParams {
  items: BulkRenewItem[];
  months: number; // global default (> 0)
}

export async function renewBulkClientSubscriptions({
  items,
  months,
}: BulkRenewParams) {
  return prisma.$transaction(async (tx: TxClient) => {
    const today = startOfDay(new Date());
    const results: { seat: Awaited<ReturnType<typeof tx.clientSubscription.update>>; log: Awaited<ReturnType<typeof tx.renewalLog.create>> }[] = [];

    for (const item of items) {
      // 1. Fetch the seat
      const seat = await tx.clientSubscription.findUniqueOrThrow({
        where: { id: item.clientSubscriptionId },
      });

      const seatMonths = item.months ?? months; // per-item override or global
      const currentExpiry = startOfDay(new Date(seat.activeUntil));
      const customPrice = Number(seat.customPrice);

      // 2. Compute new expiry — each seat independently
      const newExpiry = addMonths(currentExpiry, seatMonths);

      // 3. Period boundaries
      const periodStart = addDays(currentExpiry, 1);
      const periodEnd = newExpiry;

      // 4. Amount collected
      const paid = item.amountPaid ?? customPrice * seatMonths;

      // 5. Notes
      const finalNotes = item.notes ?? `[BULK] Renewed ${seatMonths} month(s)`;

      // 6. INSERT append-only renewal_log (one per seat)
      const log = await tx.renewalLog.create({
        data: {
          clientSubscriptionId: item.clientSubscriptionId,
          amountPaid: paid,
          expectedAmount: customPrice * seatMonths,
          periodStart,
          periodEnd,
          paidOn: today,
          dueOn: currentExpiry,
          monthsRenewed: seatMonths,
          notes: finalNotes,
        },
      });

      // 6. UPDATE the seat
      const updatedSeat = await tx.clientSubscription.update({
        where: { id: item.clientSubscriptionId },
        data: { activeUntil: newExpiry, status: "active" },
      });

      results.push({ seat: updatedSeat, log });
    }

    return { renewed: results.length, results };
  });
}

// ──────────────────────────────────────────
// renewPlatformSubscription
//
// When I pay the platform:
// 1. Read current subscription.active_until
// 2. new_expiry = current + 1 month
// 3. INSERT platform_renewal log
// 4. UPDATE subscription.active_until
// ──────────────────────────────────────────

interface RenewPlatformParams {
  subscriptionId: string;
  amountPaid?: number; // defaults to plan.cost
  notes?: string | null;
}

export async function renewPlatformSubscription({
  subscriptionId,
  amountPaid,
}: RenewPlatformParams) {
  return prisma.$transaction(async (tx: TxClient) => {
    // 1. Fetch subscription with its plan cost
    const subscription = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    // Subscriptions are now only active or paused (cancelled was removed from schema)

    const today = startOfDay(new Date());
    const currentExpiry = startOfDay(new Date(subscription.activeUntil));
    const planCost = Number(subscription.plan.cost);

    // 2. Always extend from current expiry (platform renewals are never lapsed)
    const newExpiry = addMonths(currentExpiry, 1);

    // 3. Calculate period
    const periodStart = addDays(currentExpiry, 1);
    const periodEnd = newExpiry;

    const paid = amountPaid ?? planCost;

    // 4. INSERT platform_renewal log
    const log = await tx.platformRenewal.create({
      data: {
        subscriptionId,
        amountPaid: paid,
        periodStart,
        periodEnd,
        paidOn: today,
      },
    });

    // 5. UPDATE subscription active_until
    const updated = await tx.subscription.update({
      where: { id: subscriptionId },
      data: { activeUntil: newExpiry },
    });

    return { subscription: updated, log };
  });
}

// ──────────────────────────────────────────
// Helper: format Decimal for JSON responses
// ──────────────────────────────────────────

export function decimalToNumber(val: unknown): number {
  return Number(val);
}
