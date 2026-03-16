import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const { getAuthUserId } = await import("@/lib/auth-utils");
    const userId = await getAuthUserId();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { copilotToken: true, plan: true, stripeCurrentPeriodEnd: true }
    });

    const [platformCount, clientCount, activeSeatCount, planCount, subscriptionCount] = await Promise.all([
      prisma.platform.count({ where: { userId } }),
      prisma.client.count({ where: { userId } }),
      prisma.clientSubscription.count({ 
        where: { 
          subscription: { userId },
          status: "active"
        } 
      }),
      prisma.plan.count({ where: { platform: { userId } } }),
      prisma.subscription.count({ where: { userId } })
    ]);

    return NextResponse.json({
      hasToken: !!user?.copilotToken,
      plan: user?.plan || "FREE",
      stripeCurrentPeriodEnd: user?.stripeCurrentPeriodEnd,
      usage: {
        platforms: platformCount,
        clients: clientCount,
        activeSeats: activeSeatCount,
        plans: planCount,
        subscriptions: subscriptionCount
      }
    });
  } catch (error) {
    console.error('Error checking Copilot status:', error);
    return NextResponse.json({ error: 'Failed to verify status' }, { status: 500 });
  }
}
