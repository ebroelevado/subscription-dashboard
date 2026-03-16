import { prisma } from "./prisma";
import { SAAS_LIMITS } from "./saas-constants";

export async function checkUserLimits(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  });

  if (!user || user.plan === "PREMIUM") {
    return { canCreate: true };
  }

  // Check Platforms
  const platformCount = await prisma.platform.count({ where: { userId } });
  if (platformCount >= SAAS_LIMITS.FREE.PLATFORMS) {
    return { 
      canCreate: false, 
      type: "PLATFORMS", 
      limit: SAAS_LIMITS.FREE.PLATFORMS,
      message: `You've reached the limit of ${SAAS_LIMITS.FREE.PLATFORMS} platforms for the Free plan. Upgrade to Premium for unlimited platforms.`
    };
  }

  // Check Clients
  const clientCount = await prisma.client.count({ where: { userId } });
  if (clientCount >= SAAS_LIMITS.FREE.CLIENTS) {
    return { 
      canCreate: false, 
      type: "CLIENTS", 
      limit: SAAS_LIMITS.FREE.CLIENTS,
      message: `You've reached the limit of ${SAAS_LIMITS.FREE.CLIENTS} clients for the Free plan. Upgrade to Premium for unlimited clients.`
    };
  }

  // Check Active Seats (ClientSubscription)
  const activeSeatCount = await prisma.clientSubscription.count({ 
    where: { 
      subscription: { userId },
      status: "active"
    } 
  });
  if (activeSeatCount >= SAAS_LIMITS.FREE.ACTIVE_SEATS) {
    return { 
      canCreate: false, 
      type: "SEATS", 
      limit: SAAS_LIMITS.FREE.ACTIVE_SEATS,
      message: `You've reached the limit of ${SAAS_LIMITS.FREE.ACTIVE_SEATS} active seats for the Free plan. Upgrade to Premium for unlimited seats.`
    };
  }

  return { canCreate: true };
}

export async function checkPlanLimit(userId: string, _platformId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  });

  if (!user || user.plan === "PREMIUM") {
    return { canCreate: true };
  }

  const planCount = await prisma.plan.count({
    where: {
      platform: { userId },
    },
  });

  if (planCount >= SAAS_LIMITS.FREE.PLANS) {
    return { 
      canCreate: false, 
      type: "PLANS", 
      limit: SAAS_LIMITS.FREE.PLANS,
      message: `You've reached the limit of ${SAAS_LIMITS.FREE.PLANS} plans for the Free plan. Upgrade to Premium for unlimited plans.`
    };
  }

  return { canCreate: true };
}

export async function checkSubscriptionLimit(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  });

  if (!user || user.plan === "PREMIUM") {
    return { canCreate: true };
  }

  const subscriptionCount = await prisma.subscription.count({ 
    where: { userId } 
  });

  if (subscriptionCount >= SAAS_LIMITS.FREE.SUBSCRIPTIONS) {
    return { 
      canCreate: false, 
      type: "SUBSCRIPTIONS", 
      limit: SAAS_LIMITS.FREE.SUBSCRIPTIONS,
      message: `You've reached the limit of ${SAAS_LIMITS.FREE.SUBSCRIPTIONS} subscriptions for the Free plan. Upgrade to Premium for more.`
    };
  }

  return { canCreate: true };
}
