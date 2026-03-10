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

  const perClient: Record<string, any> = {};
  const global = {
      totalDaysLate: 0,
      lateCount: 0,
      onTimeCount: 0,
      totalPayments: 0,
      totalScorePoints: 0,
      totalRenewals: 0
  };

  const now = new Date();

  for (const client of clients) {
      const clientPenalty = Number((client as any).disciplinePenalty || 1.0);
      const effectivePenaltyPerDay = BASE_PENALTY_PER_DAY * strictnessMultiplier * clientPenalty;

      if (client.clientSubscriptions.length === 0) continue;

      let cOnTimeCount = 0;
      let cLateCount = 0;
      let cTotalDaysLate = 0;
      let cTotalScorePoints = 0;
      let cTotalPayments = 0;
      let maxDaysOverdue = 0;
      let pendingAmount = 0;
      let totalRenewalLogs = 0;

      for (const seat of client.clientSubscriptions) {
          cTotalPayments++;
          cOnTimeCount++; 
          
          global.totalPayments++;
          global.onTimeCount++;

          const expiryDate = new Date(seat.activeUntil);
          if (expiryDate < now && seat.status === "active") {
              const overdueMs = now.getTime() - expiryDate.getTime();
              const overdueDays = Math.floor(overdueMs / (1000 * 60 * 60 * 24));
              if (overdueDays > maxDaysOverdue) maxDaysOverdue = overdueDays;
              pendingAmount += Number(seat.customPrice);
          }

          for (const log of seat.renewalLogs) {
              totalRenewalLogs++;
              cTotalPayments++;
              global.totalPayments++;

              const diffMs = new Date(log.paidOn).getTime() - new Date(log.dueOn).getTime();
              const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              
              let paymentScore = 10;
              if (diffDays <= 0) {
                  cOnTimeCount++;
                  global.onTimeCount++;
              } else {
                  cLateCount++;
                  cTotalDaysLate += diffDays;
                  global.lateCount++;
                  global.totalDaysLate += diffDays;

                  const deductions = diffDays * effectivePenaltyPerDay;
                  paymentScore = Math.max(0, 10 - deductions);
              }
              cTotalScorePoints += paymentScore;
              global.totalScorePoints += paymentScore;
              global.totalRenewals++;
          }
      }

      const avgDaysLate = cLateCount > 0 ? Math.round((cTotalDaysLate / cLateCount) * 10) / 10 : 0;
      const onTimeRate = cTotalPayments > 0 ? Math.round((cOnTimeCount / cTotalPayments) * 1000) / 10 : 100;
      
      const totalRenewals = cTotalPayments - client.clientSubscriptions.length; 
      let finalScore: number | null = null;
      if (totalRenewals > 0) {
          finalScore = cTotalScorePoints / totalRenewals;
      } else if (maxDaysOverdue > 0) {
          // Client has never paid, but is already overdue for their first payment/renewal
          const deductions = maxDaysOverdue * effectivePenaltyPerDay;
          finalScore = Math.max(0, 10 - deductions);
      }

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
          totalPayments: cTotalPayments,
          score: dataToPersist.disciplineScore,
          daysOverdue: maxDaysOverdue,
          pendingAmount,
          isUnpaid: totalRenewalLogs === 0,
          healthStatus,
          lateCount: cLateCount,
          onTimeCount: cOnTimeCount
      };

      try {
          await (prisma.client as any).update({
              where: { id: client.id },
              data: dataToPersist
          });
      } catch (err) {
          console.error(`[DisciplineService] Failed to persist stats for client ${client.id}:`, err);
      }
  }

  return { 
    perClient, 
    global: {
        avgDaysLate: global.lateCount > 0 ? Math.round((global.totalDaysLate / global.lateCount) * 10) / 10 : 0,
        onTimeRate: global.totalPayments > 0 ? Math.round((global.onTimeCount / global.totalPayments) * 1000) / 10 : 100,
        score: global.totalRenewals > 0 ? Math.round((global.totalScorePoints / global.totalRenewals) * 10) / 10 : 10,
        totalPayments: global.totalPayments,
        onTimeCount: global.onTimeCount,
        lateCount: global.lateCount
    }
  };
}
