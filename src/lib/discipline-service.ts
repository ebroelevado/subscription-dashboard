import { prisma } from "@/lib/prisma";

export async function getDisciplineAnalytics(userId: string, filters?: { clientId?: string; subscriptionId?: string; planId?: string }) {
  // 1. User penalty modifier
  let strictnessMultiplier = 1.0;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { disciplinePenalty: true }
    });
    if (user?.disciplinePenalty !== undefined) {
      strictnessMultiplier = user.disciplinePenalty;
    }
  } catch (e) {
    console.error("[DisciplineService] Failed to fetch strictnessMultiplier:", e);
  }
  
  const BASE_PENALTY_PER_DAY = 0.5;
  const penaltyPerDay = BASE_PENALTY_PER_DAY * strictnessMultiplier;

  // 2. Fetch clients with dynamic filters
  const clients = await prisma.client.findMany({
    where: { 
        userId,
        ...(filters?.clientId ? { id: filters.clientId } : {})
    },
    include: {
      clientSubscriptions: {
        where: {
            ...(filters?.subscriptionId ? { subscriptionId: filters.subscriptionId } : {}),
            ...(filters?.planId ? { subscription: { planId: filters.planId } } : {}),
        },
        select: {
          id: true,
          joinedAt: true,
          activeUntil: true,
          status: true,
          customPrice: true,
          renewalLogs: {
            select: { paidOn: true, dueOn: true }
          }
        }
      }
    }
  });

  const perClient: Record<string, {
    avgDaysLate: number;
    onTimeRate: number;
    totalPayments: number;
    score: number | null;
    daysOverdue: number;
    pendingAmount: number;
    isUnpaid: boolean;
    healthStatus: "Excellent" | "Good" | "Late" | "Overdue" | "Critical" | "New";
    // Detailed stats for individual view
    lateCount: number;
    onTimeCount: number;
  }> = {};

  const now = new Date();

  for (const client of clients) {
      // Use client-specific penalty or global one
      const clientPenalty = Number((client as any).disciplinePenalty || 1.0);
      const effectivePenaltyPerDay = BASE_PENALTY_PER_DAY * strictnessMultiplier * clientPenalty;

      if (client.clientSubscriptions.length === 0) continue;

      let onTimeCount = 0;
      let lateCount = 0;
      let totalDaysLate = 0;
      let totalScorePoints = 0;
      let totalPaymentsCount = 0;
      let maxDaysOverdue = 0;
      let pendingAmount = 0;
      let totalRenewalLogs = 0;

      for (const seat of client.clientSubscriptions) {
          totalPaymentsCount++;
          onTimeCount++; // Assume on time until proven otherwise for current seat
          totalRenewalLogs += seat.renewalLogs.length;

          // Check for current Overdue status (time since activeUntil)
          const expiryDate = new Date(seat.activeUntil);
          if (expiryDate < now && seat.status === "active") {
              const overdueMs = now.getTime() - expiryDate.getTime();
              const overdueDays = Math.floor(overdueMs / (1000 * 60 * 60 * 24));
              if (overdueDays > maxDaysOverdue) maxDaysOverdue = overdueDays;
              pendingAmount += Number(seat.customPrice);
          }

          for (const log of seat.renewalLogs) {
              totalPaymentsCount++;
              const diffMs = new Date(log.paidOn).getTime() - new Date(log.dueOn).getTime();
              const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              
              let paymentScore = 10;
              if (diffDays <= 0) {
                  onTimeCount++;
              } else {
                  lateCount++;
                  totalDaysLate += diffDays;
                  const deductions = diffDays * effectivePenaltyPerDay;
                  paymentScore = Math.max(0, 10 - deductions);
              }
              totalScorePoints += paymentScore;
          }
      }

      const avgDaysLate = lateCount > 0 ? Math.round((totalDaysLate / lateCount) * 10) / 10 : 0;
      const onTimeRate = totalPaymentsCount > 0 ? Math.round((onTimeCount / totalPaymentsCount) * 1000) / 10 : 100;
      
      const totalRenewals = totalPaymentsCount - client.clientSubscriptions.length; 
      let finalScore: number | null = null;
      if (totalRenewals > 0) {
          finalScore = totalScorePoints / totalRenewals;
      }

      // Determine Category
      let healthStatus: "Excellent" | "Good" | "Late" | "Overdue" | "Critical" | "New" = "New";
      if (totalRenewalLogs === 0) {
          healthStatus = maxDaysOverdue > 7 ? "Critical" : "New";
      } else if (maxDaysOverdue > 30) {
          healthStatus = "Critical";
      } else if (maxDaysOverdue > 0) {
          healthStatus = "Overdue";
      } else if (finalScore !== null) {
          if (finalScore >= 9) healthStatus = "Excellent";
          else if (finalScore >= 7) healthStatus = "Good";
          else healthStatus = "Late";
      }

      // If no history but healthy, score is 10.0
      if (finalScore === null && healthStatus === "New" && maxDaysOverdue === 0) {
          finalScore = 10.0;
      }

      const dataToPersist = {
          disciplineScore: finalScore !== null ? Math.round(finalScore * 10) / 10 : null,
          dailyPenalty: effectivePenaltyPerDay,
          daysOverdue: maxDaysOverdue,
          healthStatus: healthStatus
      };

      perClient[client.id] = {
          avgDaysLate,
          onTimeRate,
          totalPayments: totalPaymentsCount,
          score: dataToPersist.disciplineScore,
          daysOverdue: maxDaysOverdue,
          pendingAmount,
          isUnpaid: totalRenewalLogs === 0,
          healthStatus,
          lateCount,
          onTimeCount
      };

      // 4. PERSIST to Database (Source of Truth)
      // This ensures the DB always has a clear, readable value.
      try {
          await (prisma.client as any).update({
              where: { id: client.id },
              data: dataToPersist
          });
      } catch (err) {
          console.error(`[DisciplineService] Failed to persist stats for client ${client.id}:`, err);
      }
  }

  return { perClient, globalAvgDaysLate: 0 };
}
