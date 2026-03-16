import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addMonths, startOfDay } from "date-fns";

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

    // 1. Find subscriptions that are autopayable and have expired
    const subscriptionsToRenew = await prisma.subscription.findMany({
      where: {
        isAutopayable: true,
        activeUntil: {
          lte: today,
        },
        status: "active",
      },
      include: {
        plan: true,
      },
    });

    const results = [];

    for (const sub of subscriptionsToRenew) {
      const nextExpiry = addMonths(new Date(sub.activeUntil), 1);

      // Perform renewal in a transaction
      const renewal = await prisma.$transaction(async (tx) => {
        // Create PlatformRenewal record (this feeds history and analytics)
        const pRenewal = await tx.platformRenewal.create({
          data: {
            subscriptionId: sub.id,
            amountPaid: sub.plan.cost,
            periodStart: sub.activeUntil,
            periodEnd: nextExpiry,
            paidOn: today,
          },
        });

        // Update Subscription expiry
        await tx.subscription.update({
          where: { id: sub.id },
          data: { activeUntil: nextExpiry },
        });

        return pRenewal;
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
