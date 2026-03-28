type DeletionSnapshotSource = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdAt: string | Date; // SQLite returns string; Postgres returned Date
  disciplineScore: string | null;
  dailyPenalty: number | null;
  daysOverdue: number;
  healthStatus: string | null;
  clientSubscriptions: Array<{
    id: string;
    clientId: string;
    subscriptionId: string;
    customPrice: number;
    activeUntil: string;
    joinedAt: string;
    leftAt: string | null;
    status: "active" | "paused";
    remainingDays: number | null;
    serviceUser: string | null;
    servicePassword: string | null;
    renewalLogs: Array<{
      id: string;
      amountPaid: number;
      expectedAmount: number;
      periodStart: string;
      periodEnd: string;
      paidOn: string;
      dueOn: string;
      monthsRenewed: number;
      notes: string | null;
      createdAt: string | Date;
    }>;
  }>;
  ownedSubscriptions: Array<{
    id: string;
  }>;
};

export type DeletedClientSnapshot = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  disciplineScore: string | null;
  dailyPenalty: number | null;
  daysOverdue: number;
  healthStatus: string | null;
  clientSubscriptions: Array<{
    id: string;
    clientId: string;
    subscriptionId: string;
    customPrice: number;
    activeUntil: string;
    joinedAt: string;
    leftAt: string | null;
    status: "active" | "paused";
    remainingDays: number | null;
    serviceUser: string | null;
    servicePassword: string | null;
    renewalLogs: Array<{
      id: string;
      amountPaid: number;
      expectedAmount: number;
      periodStart: string;
      periodEnd: string;
      paidOn: string;
      dueOn: string;
      monthsRenewed: number;
      notes: string | null;
      createdAt: string;
    }>;
  }>;
  ownedSubscriptionIds: string[];
};

export function serializeDeletedClients(
  clients: DeletionSnapshotSource[],
): DeletedClientSnapshot[] {
  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    phone: client.phone,
    notes: client.notes,
    createdAt: typeof client.createdAt === "string" ? client.createdAt : (client.createdAt as Date).toISOString(),
    disciplineScore: client.disciplineScore,
    dailyPenalty: client.dailyPenalty,
    daysOverdue: client.daysOverdue,
    healthStatus: client.healthStatus,
    clientSubscriptions: client.clientSubscriptions.map((clientSubscription) => ({
      id: clientSubscription.id,
      clientId: clientSubscription.clientId,
      subscriptionId: clientSubscription.subscriptionId,
      customPrice: clientSubscription.customPrice,
      activeUntil: clientSubscription.activeUntil,
      joinedAt: clientSubscription.joinedAt,
      leftAt: clientSubscription.leftAt,
      status: clientSubscription.status,
      remainingDays: clientSubscription.remainingDays,
      serviceUser: clientSubscription.serviceUser,
      servicePassword: clientSubscription.servicePassword,
      renewalLogs: clientSubscription.renewalLogs.map((renewalLog) => ({
        id: renewalLog.id,
        amountPaid: renewalLog.amountPaid,
        expectedAmount: renewalLog.expectedAmount,
        periodStart: renewalLog.periodStart,
        periodEnd: renewalLog.periodEnd,
        paidOn: renewalLog.paidOn,
        dueOn: renewalLog.dueOn,
        monthsRenewed: renewalLog.monthsRenewed,
        notes: renewalLog.notes,
        createdAt: typeof renewalLog.createdAt === "string" ? renewalLog.createdAt : (renewalLog.createdAt as Date).toISOString(),
      })),
    })),
    ownedSubscriptionIds: client.ownedSubscriptions.map((subscription) => subscription.id),
  }));
}

export function parseDeletedClientSnapshots(
  value: Record<string, unknown> | unknown,
): DeletedClientSnapshot[] {
  return Array.isArray(value) ? (value as DeletedClientSnapshot[]) : [];
}

export function buildDeletedClientRestoreData(
  userId: string,
  snapshots: DeletedClientSnapshot[],
) {
  const clients: Array<{
    id: string;
    userId: string;
    name: string;
    phone: string | null;
    notes: string | null;
    createdAt: Date;
    disciplineScore: string | null;
    dailyPenalty: number | null;
    daysOverdue: number;
    healthStatus: string | null;
  }> = snapshots.map((snapshot) => ({
    id: snapshot.id,
    userId,
    name: snapshot.name,
    phone: snapshot.phone,
    notes: snapshot.notes,
    createdAt: new Date(snapshot.createdAt),
    disciplineScore: snapshot.disciplineScore,
    dailyPenalty: snapshot.dailyPenalty,
    daysOverdue: snapshot.daysOverdue,
    healthStatus: snapshot.healthStatus,
  }));

  const clientSubscriptions: Array<{
    id: string;
    clientId: string;
    subscriptionId: string;
    customPrice: number;
    activeUntil: string;
    joinedAt: string;
    leftAt: string | null;
    status: "active" | "paused";
    remainingDays: number | null;
    serviceUser: string | null;
    servicePassword: string | null;
  }> = snapshots.flatMap(
    (snapshot) =>
      snapshot.clientSubscriptions.map((clientSubscription) => ({
        id: clientSubscription.id,
        clientId: clientSubscription.clientId,
        subscriptionId: clientSubscription.subscriptionId,
        customPrice: clientSubscription.customPrice,
        activeUntil: clientSubscription.activeUntil,
        joinedAt: clientSubscription.joinedAt,
        leftAt: clientSubscription.leftAt,
        status: clientSubscription.status,
        remainingDays: clientSubscription.remainingDays,
        serviceUser: clientSubscription.serviceUser,
        servicePassword: clientSubscription.servicePassword,
      })),
  );

  const renewalLogs = snapshots.flatMap((snapshot) =>
    snapshot.clientSubscriptions.flatMap((clientSubscription) =>
      clientSubscription.renewalLogs.map((renewalLog) => ({
        id: renewalLog.id,
        clientSubscriptionId: clientSubscription.id,
        amountPaid: renewalLog.amountPaid,
        expectedAmount: renewalLog.expectedAmount,
        periodStart: renewalLog.periodStart,
        periodEnd: renewalLog.periodEnd,
        paidOn: renewalLog.paidOn,
        dueOn: renewalLog.dueOn,
        monthsRenewed: renewalLog.monthsRenewed,
        notes: renewalLog.notes,
        createdAt: renewalLog.createdAt,
      })),
    ),
  );

  const subscriptionOwners = snapshots
    .filter((snapshot) => snapshot.ownedSubscriptionIds.length > 0)
    .map((snapshot) => ({
      clientId: snapshot.id,
      subscriptionIds: snapshot.ownedSubscriptionIds,
    }));

  return {
    clients,
    clientSubscriptions,
    renewalLogs,
    subscriptionOwners,
  };
}
