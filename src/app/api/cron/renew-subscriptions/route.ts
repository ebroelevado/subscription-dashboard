import { NextResponse } from "next/server";
import { db } from "@/db";
import { eq, and, lte } from "drizzle-orm";
import { subscriptions, plans, platformRenewals } from "@/db/schema";
import { addMonths, startOfDay } from "date-fns";
import { amountToCents } from "@/lib/currency";

export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization");
    const headerSecret = req.headers.get("x-cron-secret");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (bearer !== secret && headerSecret !== secret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const today = startOfDay(new Date());
    const todayStr = today.toISOString().split("T")[0];

    // 1. Find subscriptions that are autopayable and have expired
    const subscriptionsToRenew = await db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.isAutopayable, true),
        lte(subscriptions.activeUntil, todayStr),
        eq(subscriptions.status, "active"),
      ),
      with: {
        plan: true,
      },
    });

    const results = [];

    for (const sub of subscriptionsToRenew) {
      const nextExpiry = addMonths(new Date(sub.activeUntil), 1);
      const nextExpiryStr = nextExpiry.toISOString().split("T")[0];

      // Perform renewal in a transaction
      const [renewal] = await db.transaction(async (tx) => {
        // Create PlatformRenewal record (this feeds history and analytics)
        const [pRenewal] = await tx.insert(platformRenewals).values({
          subscriptionId: sub.id,
          amountPaid: amountToCents(sub.plan.cost),
          periodStart: sub.activeUntil,
          periodEnd: nextExpiryStr,
          paidOn: todayStr,
        }).returning();

        // Update Subscription expiry
        await tx.update(subscriptions).set({ activeUntil: nextExpiryStr }).where(eq(subscriptions.id, sub.id));

        return [pRenewal];
      });

      results.push({
        id: sub.id,
        label: sub.label,
        newExpiry: nextExpiry,
        renewalId: renewal.id,
      });
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      renewals: results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown cron renewal error";
    console.error("[CRON RENEWAL ERROR]", err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
