import { eq, and, count } from "drizzle-orm";
import { db } from "@/db";
import { users, platforms, clients, clientSubscriptions, subscriptions, plans } from "@/db/schema";
import { SAAS_LIMITS } from "./saas-constants";

type LimitCheck = {
  canCreate: boolean;
  reason?: string;
  current?: number;
  limit?: number;
};

type UserPlan = "FREE" | "PREMIUM";

async function getUserPlan(userId: string): Promise<UserPlan> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { plan: true },
  });

  return (user?.plan as UserPlan | undefined) ?? "FREE";
}

function passesLimit(current: number, limit: number, resourceName: string): LimitCheck {
  if (current < limit) {
    return { canCreate: true, current, limit };
  }

  return {
    canCreate: false,
    reason: `${resourceName} limit reached (${current}/${limit})`,
    current,
    limit,
  };
}

export async function checkUserLimits(userId: string): Promise<LimitCheck> {
  const plan = await getUserPlan(userId);
  if (plan === "PREMIUM") {
    return { canCreate: true };
  }

  // Backward-compatible fallback: evaluate the strictest user-level limit first.
  return checkPlatformLimit(userId);
}

export async function checkPlatformLimit(userId: string): Promise<LimitCheck> {
  const plan = await getUserPlan(userId);
  if (plan === "PREMIUM") {
    return { canCreate: true };
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(platforms)
    .where(eq(platforms.userId, userId));

  return passesLimit(total, SAAS_LIMITS.FREE.PLATFORMS, "Platform");
}

export async function checkClientLimit(userId: string): Promise<LimitCheck> {
  const plan = await getUserPlan(userId);
  if (plan === "PREMIUM") {
    return { canCreate: true };
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(clients)
    .where(eq(clients.userId, userId));

  return passesLimit(total, SAAS_LIMITS.FREE.CLIENTS, "Client");
}

export async function checkActiveSeatLimit(userId: string): Promise<LimitCheck> {
  const plan = await getUserPlan(userId);
  if (plan === "PREMIUM") {
    return { canCreate: true };
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(clientSubscriptions)
    .innerJoin(subscriptions, eq(subscriptions.id, clientSubscriptions.subscriptionId))
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(clientSubscriptions.status, "active"),
      ),
    );

  return passesLimit(total, SAAS_LIMITS.FREE.ACTIVE_SEATS, "Active seat");
}

export async function checkPlanLimit(userId: string, _platformId: string): Promise<LimitCheck> {
  const plan = await getUserPlan(userId);
  if (plan === "PREMIUM") {
    return { canCreate: true };
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(plans)
    .where(eq(plans.userId, userId));

  return passesLimit(total, SAAS_LIMITS.FREE.PLANS, "Plan");
}

export async function checkSubscriptionLimit(userId: string): Promise<LimitCheck> {
  const plan = await getUserPlan(userId);
  if (plan === "PREMIUM") {
    return { canCreate: true };
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  return passesLimit(total, SAAS_LIMITS.FREE.SUBSCRIPTIONS, "Subscription");
}
