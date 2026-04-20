import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientSubscriptions, clients, plans, platforms, subscriptions, users } from "@/db/schema";

export async function GET() {
  try {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        plan: true,
        stripeCurrentPeriodEnd: true,
      },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const [{ platformsCount }] = await db
      .select({ platformsCount: count() })
      .from(platforms)
      .where(eq(platforms.userId, userId));

    const [{ clientsCount }] = await db
      .select({ clientsCount: count() })
      .from(clients)
      .where(eq(clients.userId, userId));

    const [{ plansCount }] = await db
      .select({ plansCount: count() })
      .from(plans)
      .where(eq(plans.userId, userId));

    const [{ subscriptionsCount }] = await db
      .select({ subscriptionsCount: count() })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));

    const [{ activeSeatsCount }] = await db
      .select({ activeSeatsCount: count() })
      .from(clientSubscriptions)
      .innerJoin(subscriptions, eq(subscriptions.id, clientSubscriptions.subscriptionId))
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(clientSubscriptions.status, "active"),
        ),
      );

    return NextResponse.json({
      ok: true,
      data: {
        plan: user.plan,
        stripeCurrentPeriodEnd: user.stripeCurrentPeriodEnd,
        usage: {
          platforms: platformsCount,
          clients: clientsCount,
          activeSeats: activeSeatsCount,
          plans: plansCount,
          subscriptions: subscriptionsCount,
        },
      },
    });
  } catch (error) {
    console.error("[SAAS_STATUS_ERROR]", error);
    return NextResponse.json({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
