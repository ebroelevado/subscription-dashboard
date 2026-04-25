import { NextResponse } from "next/server";
import { db } from "@/db";
import { and, lte, eq } from "drizzle-orm";
import { subscriptions } from "@/db/schema";
import { startOfDay } from "date-fns";
import { renewPlatformSubscription } from "@/lib/services/renewals";

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
    });

    const results = [];

    for (const sub of subscriptionsToRenew) {
      // Use the centralized service for renewal
      // This ensures correct amount (cents) and consistent logging
      const { subscription, log } = await renewPlatformSubscription({
        subscriptionId: sub.id,
        months: 1, // Auto-renewals are always 1 month
        notes: "Auto-renewed by cron job",
      });

      results.push({
        id: sub.id,
        label: sub.label,
        newExpiry: subscription.activeUntil,
        renewalId: log.id,
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
