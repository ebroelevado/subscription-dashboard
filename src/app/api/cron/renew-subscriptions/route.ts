import { NextResponse } from "next/server";
import { db } from "@/db";
import { and, lte, eq } from "drizzle-orm";
import { subscriptions, clientSubscriptions } from "@/db/schema";
import { startOfDay } from "date-fns";
import { renewPlatformSubscription, renewClientSubscription } from "@/lib/services/renewals";

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

    // 1. Find platform subscriptions that are autopayable and have expired
    const platformToRenew = await db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.autoRenewal, true),
        lte(subscriptions.activeUntil, todayStr),
        eq(subscriptions.status, "active"),
      ),
    });

    const platformResults = [];

    for (const sub of platformToRenew) {
      const { subscription, log } = await renewPlatformSubscription({
        subscriptionId: sub.id,
        months: 1,
        notes: "Auto-renewed by cron job (Platform)",
      });

      platformResults.push({
        id: sub.id,
        label: sub.label,
        newExpiry: subscription.activeUntil,
        renewalId: log.id,
        type: "platform",
      });
    }

    // 2. Find client subscriptions that are autopayable and have expired
    const clientToRenew = await db.query.clientSubscriptions.findMany({
      where: and(
        eq(clientSubscriptions.autoRenewal, true),
        lte(clientSubscriptions.activeUntil, todayStr),
        eq(clientSubscriptions.status, "active"),
      ),
    });

    const clientResults = [];

    for (const seat of clientToRenew) {
      const { seat: updatedSeat, log } = await renewClientSubscription({
        clientSubscriptionId: seat.id,
        months: 1,
        notes: "Auto-renewed by cron job (Client)",
      });

      clientResults.push({
        id: seat.id,
        newExpiry: updatedSeat.activeUntil,
        renewalId: log.id,
        type: "client",
      });
    }

    return NextResponse.json({
      ok: true,
      processed: platformResults.length + clientResults.length,
      platformRenewals: platformResults,
      clientRenewals: clientResults,
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
