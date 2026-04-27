import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, clients, clientSubscriptions, subscriptions } from "@/db/schema";
import { amountToCents } from "@/lib/currency";

const DAY_IN_MS = 1000 * 60 * 60 * 24;

function toUtcMidnightTimestamp(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

function diffCalendarDays(later: Date, earlier: Date) {
  return Math.floor((toUtcMidnightTimestamp(later) - toUtcMidnightTimestamp(earlier)) / DAY_IN_MS);
}

export async function getDisciplineAnalytics(userId: string, filters?: { clientId?: string; subscriptionId?: string; planId?: string }) {
  // Organic daily score deduction (hits 0 at exactly 30 days)
  const dailyPenalty = 10000 / 30;

  // 2. Fetch clients with dynamic filters
  const csConditions = [];
  if (filters?.subscriptionId) {
    csConditions.push(eq(clientSubscriptions.subscriptionId, filters.subscriptionId));
  }
  if (filters?.planId) {
    const subs = await db.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.planId, filters.planId));
    if (subs.length > 0) {
      csConditions.push(inArray(clientSubscriptions.subscriptionId, subs.map(s => s.id)));
    } else {
      csConditions.push(sql`false`); // No matches
    }
  }

  const clientsData = await db.query.clients.findMany({
    where: and(
      eq(clients.userId, userId),
      filters?.clientId ? eq(clients.id, filters.clientId) : undefined
    ),
    with: {
      clientSubscriptions: {
        columns: {
          id: true,
          joinedAt: true,
          activeUntil: true,
          status: true,
          customPrice: true,
        },
        where: csConditions.length > 0 ? and(...csConditions) : undefined,
        with: {
          renewalLogs: {
            columns: {
              paidOn: true,
              dueOn: true,
            }
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

  for (const client of clientsData) {
      const effectivePenaltyPerDay = dailyPenalty;

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
          const expiryDate = new Date(seat.activeUntil + "T00:00:00");
          if (expiryDate < now && seat.status === "active") {
            const overdueDays = Math.max(0, diffCalendarDays(now, expiryDate));
              if (overdueDays > maxDaysOverdue) maxDaysOverdue = overdueDays;
              pendingAmount += Number(seat.customPrice);
          }

          for (const log of seat.renewalLogs) {
              totalRenewalLogs++;
              cTotalPayments++;
              global.totalPayments++;

                const diffDays = diffCalendarDays(new Date(log.paidOn + "T00:00:00"), new Date(log.dueOn + "T00:00:00"));
              
              let paymentScore = 10000;
              if (diffDays <= 0) {
                  cOnTimeCount++;
                  global.onTimeCount++;
              } else {
                  cLateCount++;
                  cTotalDaysLate += diffDays;
                  global.lateCount++;
                  global.totalDaysLate += diffDays;

                  const deductions = diffDays * effectivePenaltyPerDay;
                  paymentScore = Math.max(0, 10000 - deductions);
              }
              cTotalScorePoints += paymentScore;
              global.totalScorePoints += paymentScore;
              global.totalRenewals++;
          }
      }

      const avgDaysLate = cLateCount > 0 ? Math.round((cTotalDaysLate / cLateCount) * 10) / 10 : 0;
      const onTimeRate = cTotalPayments > 0 ? Math.round((cOnTimeCount / cTotalPayments) * 1000) / 10 : 100;
      
      const totalRenewals = cTotalPayments;
      let finalScore: number | null = null;
      if (totalRenewals > 0) {
          finalScore = cTotalScorePoints / totalRenewals;
      } else if (maxDaysOverdue > 0) {
          // Client has never paid, but is already overdue for their first payment/renewal
          const deductions = maxDaysOverdue * effectivePenaltyPerDay;
          finalScore = Math.max(0, 10000 - deductions);
      }

      let healthStatus: "Excellent" | "Good" | "Late" | "Overdue" | "Critical" | "New" = "New";
      if (totalRenewalLogs === 0) {
          healthStatus = maxDaysOverdue > 7 ? "Critical" : "New";
      } else if (maxDaysOverdue > 30) {
          healthStatus = "Critical";
      } else if (maxDaysOverdue > 0) {
          healthStatus = "Overdue";
      } else if (finalScore !== null) {
          if (finalScore >= 9000) healthStatus = "Excellent";
          else if (finalScore >= 7000) healthStatus = "Good";
          else healthStatus = "Late";
      }

      if (finalScore === null && healthStatus === "New" && maxDaysOverdue === 0) {
          finalScore = 10000;
      }

      const dataToPersist = {
          disciplineScore: finalScore !== null ? Math.floor(finalScore).toString() : null,
          dailyPenalty: amountToCents(effectivePenaltyPerDay),
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
          await db.update(clients).set(dataToPersist).where(eq(clients.id, client.id));
      } catch (err) {
          console.error(`[DisciplineService] Failed to persist stats for client ${client.id}:`, err);
      }
  }

  return { 
    perClient, 
    global: {
        avgDaysLate: global.lateCount > 0 ? Math.round((global.totalDaysLate / global.lateCount) * 10) / 10 : 0,
        onTimeRate: global.totalPayments > 0 ? Math.round((global.onTimeCount / global.totalPayments) * 1000) / 10 : 100,
        score: global.totalRenewals > 0 ? Math.floor(global.totalScorePoints / global.totalRenewals) : 10000,
        totalPayments: global.totalPayments,
        onTimeCount: global.onTimeCount,
        lateCount: global.lateCount
    }
  };
}
