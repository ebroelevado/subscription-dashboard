"use client";

import { useMemo, useState } from "react";
import {
  useAnalyticsHistory,
  useUpdateHistoryEntry,
  undoHistoryMutation,
  type HistoryFilters,
  type HistoryRow,
} from "@/hooks/use-analytics";
import { usePlatforms } from "@/hooks/use-platforms";
import { usePlans } from "@/hooks/use-plans";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { useClients } from "@/hooks/use-clients";
import { useQueryClient } from "@tanstack/react-query";
import { downloadCSV } from "@/lib/csv-export";
import { invalidateAll } from "@/lib/invalidate-helpers";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useSession } from "@/lib/auth-client";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ArrowUpCircle,
  ArrowDownCircle,
  Pencil,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

const columnHelper = createColumnHelper<HistoryRow>();

type EditableHistoryDraft = {
  type: "income" | "cost";
  amountPaid: string;
  paidOn: string;
  periodStart: string;
  periodEnd: string;
  notes: string;
  platformId: string;
  planId: string;
  subscriptionId: string;
  clientId: string;
  clientSubscriptionId: string | null;
};

type SelectOption = {
  id: string;
  label: string;
};

type SubscriptionOption = {
  id: string;
  label: string;
  ownerId: string | null;
};

type SeatOption = {
  clientId: string;
  clientName: string;
  clientSubscriptionId: string;
};

type HistoryColumnsOptions = {
  editable: boolean;
  drafts: Record<string, EditableHistoryDraft>;
  onDraftChange: (id: string, field: keyof EditableHistoryDraft, value: string) => void;
  onTypeChange: (row: HistoryRow, value: "income" | "cost") => void;
  onRelationChange: (
    row: HistoryRow,
    field: "platformId" | "planId" | "subscriptionId" | "clientId",
    value: string,
  ) => void;
  platformOptions: SelectOption[];
  planOptionsByPlatform: Record<string, SelectOption[]>;
  subscriptionOptionsByPlan: Record<string, SubscriptionOption[]>;
  seatOptionsBySubscription: Record<string, SeatOption[]>;
  ownerOptionsByPlan: Record<string, SelectOption[]>;
};

const AUTO_EDIT_REASON = "Bulk edit from history table";
const NONE_OPTION = "__none__";

function notesForDraft(notes: string | null): string {
  return notes === "platform_payment" ? "" : (notes ?? "");
}

function useHistoryColumns({
  editable,
  drafts,
  onDraftChange,
  onTypeChange,
  onRelationChange,
  platformOptions,
  planOptionsByPlatform,
  subscriptionOptionsByPlan,
  seatOptionsBySubscription,
  ownerOptionsByPlan,
}: HistoryColumnsOptions) {
  const t = useTranslations("history");

  return [
    columnHelper.accessor("paidOn", {
      header: t("date"),
      cell: (info) => {
        if (!editable) {
          return <span className="font-medium tabular-nums">{info.getValue()}</span>;
        }
        const draft = drafts[info.row.original.id];
        return (
          <Input
            type="date"
            value={draft?.paidOn ?? info.getValue()}
            onChange={(e) => onDraftChange(info.row.original.id, "paidOn", e.target.value)}
            className="h-8 min-w-36"
          />
        );
      },
    }),
    columnHelper.accessor("type", {
      header: t("type"),
      cell: (info) => {
        const draft = drafts[info.row.original.id];
        const type = info.getValue();

        if (editable && draft) {
          return (
            <Select
              value={draft.type}
              onValueChange={(value) => onTypeChange(info.row.original, value as "income" | "cost")}
            >
              <SelectTrigger className="h-8 min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">{t("income")}</SelectItem>
                <SelectItem value="cost">{t("expense")}</SelectItem>
              </SelectContent>
            </Select>
          );
        }

        return (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              type === "income"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
            )}
          >
            {type === "income" ? (
              <ArrowUpCircle className="size-3" />
            ) : (
              <ArrowDownCircle className="size-3" />
            )}
            {type === "income" ? t("income") : t("expense")}
          </span>
        );
      },
    }),
    columnHelper.accessor("amount", {
      header: () => <span className="text-right block">{t("amount")}</span>,
      cell: ({ row }) => {
        if (!editable) {
          return (
            <AmountCell
              amount={Number(row.getValue("amount"))}
              type={row.original.type}
            />
          );
        }

        const draft = drafts[row.original.id];
        return (
          <Input
            type="number"
            min="0"
            step="0.01"
            value={draft?.amountPaid ?? String(Number(row.getValue("amount")))}
            onChange={(e) => onDraftChange(row.original.id, "amountPaid", e.target.value)}
            className="h-8 min-w-28 text-right"
          />
        );
      },
    }),
    columnHelper.accessor("platform", {
      header: t("platform"),
      cell: (info) => {
        if (!editable) return info.getValue();

        const row = info.row.original;
        const draft = drafts[row.id];
        if (!draft) return row.platform;

        const value = draft.platformId || NONE_OPTION;
        const options = platformOptions.some((p) => p.id === draft.platformId)
          ? platformOptions
          : draft.platformId
            ? [...platformOptions, { id: draft.platformId, label: row.platform }]
            : platformOptions;

        return (
          <Select
            value={value}
            onValueChange={(v) => {
              if (v !== NONE_OPTION) onRelationChange(row, "platformId", v);
            }}
          >
            <SelectTrigger className="h-8 min-w-40">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_OPTION}>—</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    }),
    columnHelper.accessor("plan", {
      header: t("plan"),
      cell: (info) => {
        if (!editable) return info.getValue();

        const row = info.row.original;
        const draft = drafts[row.id];
        if (!draft) return row.plan;

        const options = planOptionsByPlatform[draft.platformId] ?? [];
        const value = draft.planId || NONE_OPTION;
        const optionsWithFallback = options.some((p) => p.id === draft.planId)
          ? options
          : draft.planId
            ? [...options, { id: draft.planId, label: row.plan }]
            : options;

        return (
          <Select
            value={value}
            onValueChange={(v) => {
              if (v !== NONE_OPTION) onRelationChange(row, "planId", v);
            }}
          >
            <SelectTrigger className="h-8 min-w-40">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_OPTION}>—</SelectItem>
              {optionsWithFallback.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    }),
    columnHelper.accessor("subscriptionLabel", {
      header: t("subscription"),
      cell: (info) => {
        if (!editable) return info.getValue();

        const row = info.row.original;
        const draft = drafts[row.id];
        if (!draft) return row.subscriptionLabel;

        const options = subscriptionOptionsByPlan[draft.planId] ?? [];
        const value = draft.subscriptionId || NONE_OPTION;
        const optionsWithFallback = options.some((s) => s.id === draft.subscriptionId)
          ? options
          : draft.subscriptionId
            ? [...options, { id: draft.subscriptionId, label: row.subscriptionLabel, ownerId: row.clientId }]
            : options;

        return (
          <Select
            value={value}
            onValueChange={(v) => {
              if (v !== NONE_OPTION) onRelationChange(row, "subscriptionId", v);
            }}
          >
            <SelectTrigger className="h-8 min-w-40">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_OPTION}>—</SelectItem>
              {optionsWithFallback.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    }),
    columnHelper.accessor("clientName", {
      header: t("client"),
      cell: (info) => {
        if (!editable) return info.getValue() ?? "—";

        const row = info.row.original;
        const draft = drafts[row.id];
        if (!draft) return row.clientName ?? "—";

        const options = draft.type === "income"
          ? (seatOptionsBySubscription[draft.subscriptionId] ?? []).map((seat) => ({
              id: seat.clientId,
              label: seat.clientName,
            }))
          : (ownerOptionsByPlan[draft.planId] ?? []);

        const value = draft.clientId || NONE_OPTION;
        const optionsWithFallback = options.some((option) => option.id === draft.clientId)
          ? options
          : draft.clientId
            ? [...options, { id: draft.clientId, label: row.clientName ?? "Deleted Client" }]
            : options;

        return (
          <Select
            value={value}
            onValueChange={(v) => {
              if (v !== NONE_OPTION) onRelationChange(row, "clientId", v);
            }}
          >
            <SelectTrigger className="h-8 min-w-44">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_OPTION}>—</SelectItem>
              {optionsWithFallback.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    }),
    columnHelper.accessor("periodStart", {
      header: t("period"),
      cell: (info) => {
        if (!editable) {
          return (
            <span className="tabular-nums text-muted-foreground text-xs">
              {info.getValue()} → {info.row.original.periodEnd}
            </span>
          );
        }

        const draft = drafts[info.row.original.id];
        return (
          <div className="flex flex-col gap-1">
            <Input
              type="date"
              value={draft?.periodStart ?? info.row.original.periodStart}
              onChange={(e) => onDraftChange(info.row.original.id, "periodStart", e.target.value)}
              className="h-8 min-w-36"
            />
            <Input
              type="date"
              value={draft?.periodEnd ?? info.row.original.periodEnd}
              onChange={(e) => onDraftChange(info.row.original.id, "periodEnd", e.target.value)}
              className="h-8 min-w-36"
            />
          </div>
        );
      },
    }),
    columnHelper.accessor("notes", {
      header: t("notes"),
      cell: (info) => {
        if (editable) {
          const draft = drafts[info.row.original.id];
          return (
            <Input
              value={draft?.notes ?? notesForDraft(info.row.original.notes)}
              onChange={(e) => onDraftChange(info.row.original.id, "notes", e.target.value)}
              className="h-8 min-w-44"
              placeholder={t("optionalNotes")}
            />
          );
        }

        const val = info.getValue();
        if (!val) return <span className="text-muted-foreground">—</span>;
        const displayVal = val === "platform_payment" ? t("platformPayment") : val;
        return (
          <span className="max-w-[200px] truncate block text-xs" title={displayVal}>
            {displayVal}
          </span>
        );
      },
    }),
  ];
}

function AmountCell({ amount, type }: { amount: number; type: string }) {
  const { data: session } = useSession();
  const currency = (session?.user as { currency?: string })?.currency || "EUR";
  const isIncome = type === "income";
  
  return (
    <span
      className={cn(
        "block text-right font-semibold tabular-nums",
        isIncome
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400"
      )}
    >
      {isIncome ? "+" : "−"}
      {formatCurrency(amount, currency)}
    </span>
  );
}

export default function HistoryPage() {
  const t = useTranslations("history");
  const tc = useTranslations("common");
  const qc = useQueryClient();

  const [filters, setFilters] = useState<HistoryFilters>({
    page: 1,
    pageSize: 20,
    type: "all",
  });
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [draftRows, setDraftRows] = useState<Record<string, EditableHistoryDraft>>({});

  const { data, isLoading } = useAnalyticsHistory(filters);
  const { data: platforms } = usePlatforms();
  const { data: plans } = usePlans();
  const { data: subscriptions } = useSubscriptions();
  const { data: clients } = useClients();
  const updateHistoryEntry = useUpdateHistoryEntry();

  const platformOptions = useMemo<SelectOption[]>(
    () => (platforms ?? []).map((platform) => ({ id: platform.id, label: platform.name })),
    [platforms],
  );

  const planOptionsByPlatform = useMemo<Record<string, SelectOption[]>>(() => {
    const grouped: Record<string, SelectOption[]> = {};
    for (const plan of plans ?? []) {
      if (!grouped[plan.platformId]) grouped[plan.platformId] = [];
      grouped[plan.platformId].push({ id: plan.id, label: plan.name });
    }
    return grouped;
  }, [plans]);

  const subscriptionOptionsByPlan = useMemo<Record<string, SubscriptionOption[]>>(() => {
    const grouped: Record<string, SubscriptionOption[]> = {};
    for (const subscription of subscriptions ?? []) {
      if (!grouped[subscription.planId]) grouped[subscription.planId] = [];
      grouped[subscription.planId].push({
        id: subscription.id,
        label: subscription.label,
        ownerId: subscription.ownerId ?? null,
      });
    }
    return grouped;
  }, [subscriptions]);

  const subscriptionsById = useMemo(
    () => Object.fromEntries((subscriptions ?? []).map((subscription) => [subscription.id, subscription])),
    [subscriptions],
  );

  const seatOptionsBySubscription = useMemo<Record<string, SeatOption[]>>(() => {
    const grouped: Record<string, SeatOption[]> = {};

    for (const client of clients ?? []) {
      for (const seat of client.clientSubscriptions) {
        const subscriptionId = seat.subscription.id;
        if (!grouped[subscriptionId]) grouped[subscriptionId] = [];

        grouped[subscriptionId].push({
          clientId: client.id,
          clientName: client.name,
          clientSubscriptionId: seat.id,
        });
      }
    }

    return grouped;
  }, [clients]);

  const ownerOptionsByPlan = useMemo<Record<string, SelectOption[]>>(() => {
    const clientNameById = new Map((clients ?? []).map((client) => [client.id, client.name]));
    const grouped: Record<string, SelectOption[]> = {};

    for (const subscription of subscriptions ?? []) {
      if (!subscription.ownerId) continue;
      if (!grouped[subscription.planId]) grouped[subscription.planId] = [];

      const ownerLabel = clientNameById.get(subscription.ownerId) ?? "Deleted Client";
      if (!grouped[subscription.planId].some((option) => option.id === subscription.ownerId)) {
        grouped[subscription.planId].push({
          id: subscription.ownerId,
          label: ownerLabel,
        });
      }
    }

    return grouped;
  }, [clients, subscriptions]);

  const invalidateHistory = () => {
    invalidateAll(qc);
    qc.invalidateQueries({ queryKey: ["analytics-history"] });
  };

  const handleUndo = async (auditLogId: string) => {
    try {
      await undoHistoryMutation(auditLogId);
      invalidateHistory();
      toast.success(t("undoSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("undoError"));
    }
  };

  const startEditMode = () => {
    const nextDrafts = Object.fromEntries(
      (data?.rows ?? []).map((row) => [
        row.id,
        {
          type: row.type,
          amountPaid: String(row.amount),
          paidOn: row.paidOn,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          notes: notesForDraft(row.notes),
          platformId: row.platformId ?? "",
          planId: row.planId ?? "",
          subscriptionId: row.subscriptionId,
          clientId: row.clientId ?? "",
          clientSubscriptionId: row.clientSubscriptionId,
        } satisfies EditableHistoryDraft,
      ]),
    );

    setDraftRows(nextDrafts);
    setIsEditMode(true);
  };

  const cancelEditMode = () => {
    setIsEditMode(false);
    setDraftRows({});
  };

  const updateDraftField = (id: string, field: keyof EditableHistoryDraft, value: string) => {
    setDraftRows((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      return {
        ...prev,
        [id]: {
          ...existing,
          [field]: value,
        },
      };
    });
  };

  const updateRelationField = (
    row: HistoryRow,
    field: "platformId" | "planId" | "subscriptionId" | "clientId",
    value: string,
  ) => {
    setDraftRows((prev) => {
      const existing = prev[row.id];
      if (!existing) return prev;

      const nextDraft: EditableHistoryDraft = {
        ...existing,
        [field]: value,
      };

      const syncFromSubscription = () => {
        if (nextDraft.type === "income") {
          const seats = seatOptionsBySubscription[nextDraft.subscriptionId] ?? [];
          const matchedSeat = seats.find((seat) => seat.clientId === nextDraft.clientId);
          const selectedSeat = matchedSeat ?? seats[0];
          nextDraft.clientId = selectedSeat?.clientId ?? "";
          nextDraft.clientSubscriptionId = selectedSeat?.clientSubscriptionId ?? null;
          return;
        }

        const selectedSubscription = subscriptionsById[nextDraft.subscriptionId];
        nextDraft.clientId = selectedSubscription?.ownerId ?? "";
        nextDraft.clientSubscriptionId = null;
      };

      if (field === "platformId") {
        const plansForPlatform = planOptionsByPlatform[value] ?? [];
        if (!plansForPlatform.some((plan) => plan.id === nextDraft.planId)) {
          nextDraft.planId = plansForPlatform[0]?.id ?? "";
        }

        const subscriptionsForPlan = subscriptionOptionsByPlan[nextDraft.planId] ?? [];
        if (!subscriptionsForPlan.some((subscription) => subscription.id === nextDraft.subscriptionId)) {
          nextDraft.subscriptionId = subscriptionsForPlan[0]?.id ?? "";
        }

        syncFromSubscription();
      }

      if (field === "planId") {
        const subscriptionsForPlan = subscriptionOptionsByPlan[value] ?? [];
        if (!subscriptionsForPlan.some((subscription) => subscription.id === nextDraft.subscriptionId)) {
          nextDraft.subscriptionId = subscriptionsForPlan[0]?.id ?? "";
        }

        syncFromSubscription();
      }

      if (field === "subscriptionId") {
        syncFromSubscription();
      }

      if (field === "clientId") {
        if (nextDraft.type === "income") {
          const seats = seatOptionsBySubscription[nextDraft.subscriptionId] ?? [];
          const selectedSeat = seats.find((seat) => seat.clientId === value);
          nextDraft.clientId = selectedSeat?.clientId ?? value;
          nextDraft.clientSubscriptionId = selectedSeat?.clientSubscriptionId ?? null;
        } else {
          nextDraft.clientId = value;
          nextDraft.clientSubscriptionId = null;
          const subscriptionsForPlan = subscriptionOptionsByPlan[nextDraft.planId] ?? [];
          const matchingSubscription = subscriptionsForPlan.find((subscription) => subscription.ownerId === value);
          if (matchingSubscription) {
            nextDraft.subscriptionId = matchingSubscription.id;
          }
        }
      }

      return {
        ...prev,
        [row.id]: nextDraft,
      };
    });
  };

  const updateDraftType = (row: HistoryRow, value: "income" | "cost") => {
    setDraftRows((prev) => {
      const existing = prev[row.id];
      if (!existing) return prev;

      const nextDraft: EditableHistoryDraft = {
        ...existing,
        type: value,
      };

      if (value === "income") {
        const seats = seatOptionsBySubscription[nextDraft.subscriptionId] ?? [];
        const selectedSeat = seats.find((seat) => seat.clientId === nextDraft.clientId) ?? seats[0];
        nextDraft.clientId = selectedSeat?.clientId ?? "";
        nextDraft.clientSubscriptionId = selectedSeat?.clientSubscriptionId ?? null;
      } else {
        const selectedSubscription = subscriptionsById[nextDraft.subscriptionId];
        nextDraft.clientId = selectedSubscription?.ownerId ?? "";
        nextDraft.clientSubscriptionId = null;
      }

      return {
        ...prev,
        [row.id]: nextDraft,
      };
    });
  };

  const changedRows = (data?.rows ?? []).filter((row) => {
    const draft = draftRows[row.id];
    if (!draft) return false;

    return (
      draft.type !== row.type
      ||
      Number(draft.amountPaid) !== row.amount
      || draft.paidOn !== row.paidOn
      || draft.periodStart !== row.periodStart
      || draft.periodEnd !== row.periodEnd
      || draft.notes.trim() !== notesForDraft(row.notes).trim()
      || draft.platformId !== (row.platformId ?? "")
      || draft.planId !== (row.planId ?? "")
      || draft.subscriptionId !== row.subscriptionId
      || draft.clientId !== (row.clientId ?? "")
      || (draft.clientSubscriptionId ?? "") !== (row.clientSubscriptionId ?? "")
    );
  });

  const columns = useHistoryColumns({
    editable: isEditMode,
    drafts: draftRows,
    onDraftChange: updateDraftField,
    onTypeChange: updateDraftType,
    onRelationChange: updateRelationField,
    platformOptions,
    planOptionsByPlatform,
    subscriptionOptionsByPlan,
    seatOptionsBySubscription,
    ownerOptionsByPlan,
  });

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const updateFilter = (key: keyof HistoryFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
      page: key !== "page" ? 1 : prev.page,
    }));
  };

  const submitEdit = async () => {
    if (changedRows.length === 0) {
      toast.error(t("editError"));
      return;
    }

    setIsSavingEdits(true);
    try {
      const successfulAuditLogIds: string[] = [];

      for (const row of changedRows) {
        const draft = draftRows[row.id];
        if (!draft) continue;

        const amountPaid = Number(draft.amountPaid);
        if (!Number.isFinite(amountPaid) || amountPaid < 0) {
          throw new Error(t("editError"));
        }

        if (draft.type === "income" && !draft.clientSubscriptionId) {
          throw new Error(t("editError"));
        }

        if (draft.type === "cost" && !draft.subscriptionId) {
          throw new Error(t("editError"));
        }

        const response = await updateHistoryEntry.mutateAsync({
          id: row.id,
          type: row.type,
          nextType: draft.type,
          reason: AUTO_EDIT_REASON,
          amountPaid,
          paidOn: draft.paidOn,
          periodStart: draft.periodStart,
          periodEnd: draft.periodEnd,
          notes: draft.notes.trim() ? draft.notes.trim() : null,
          subscriptionId: draft.subscriptionId || undefined,
          clientSubscriptionId: draft.type === "income" ? (draft.clientSubscriptionId ?? undefined) : undefined,
        });

        successfulAuditLogIds.push(response.auditLogId);
      }

      if (successfulAuditLogIds.length === 1) {
        toast.success(t("editSuccess"), {
          action: {
            label: t("undo"),
            onClick: () => {
              void handleUndo(successfulAuditLogIds[0]);
            },
          },
        });
      } else {
        toast.success(t("editSuccess"));
      }

      cancelEditMode();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("editError"));
    } finally {
      setIsSavingEdits(false);
    }
  };

  const handleExport = () => {
    if (!data?.rows.length) return;
    downloadCSV(
      data.rows.map((r) => ({
        Date: r.paidOn,
        Type: r.type,
        Amount: r.amount,
        Platform: r.platform,
        Plan: r.plan,
        Subscription: r.subscriptionLabel,
        Client: r.clientName ?? "",
        PeriodStart: r.periodStart,
        PeriodEnd: r.periodEnd,
        Notes: r.notes === "platform_payment" ? t("platformPayment") : (r.notes ?? ""),
      })),
      `pearfect-ledger-${new Date().toISOString().split("T")[0]}`
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditMode ? (
            <>
              <Button
                variant="outline"
                onClick={cancelEditMode}
                disabled={isSavingEdits || updateHistoryEntry.isPending}
              >
                {tc("cancel")}
              </Button>
              <Button
                onClick={submitEdit}
                disabled={
                  isSavingEdits
                  || updateHistoryEntry.isPending
                  || changedRows.length === 0
                }
              >
                {isSavingEdits ? t("saving") : t("saveChanges")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={startEditMode}
              disabled={!data?.rows.length || isLoading}
            >
              <Pencil className="size-4" />
              {t("editEntry")}
            </Button>
          )}

          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!data?.rows.length || isSavingEdits}
          >
            <Download className="size-4" />
            {t("exportCsv")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("type")}</label>
          <Select
            value={filters.type ?? "all"}
            onValueChange={(v) => updateFilter("type", v)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTypes")}</SelectItem>
              <SelectItem value="income">{t("income")}</SelectItem>
              <SelectItem value="cost">{t("expense")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("platform")}</label>
          <Select
            value={filters.platformId ?? "all"}
            onValueChange={(v) => updateFilter("platformId", v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder={tc("allPlatforms")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tc("allPlatforms")}</SelectItem>
              {platforms?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("plan")}</label>
          <Select
            value={filters.planId ?? "all"}
            onValueChange={(v) => updateFilter("planId", v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder={tc("allPlans")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tc("allPlans")}</SelectItem>
              {plans?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("date")}</label>
          <Input
            type="date"
            className="w-40"
            value={filters.dateFrom ?? ""}
            onChange={(e) => updateFilter("dateFrom", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("to")}</label>
          <Input
            type="date"
            className="w-40"
            value={filters.dateTo ?? ""}
            onChange={(e) => updateFilter("dateTo", e.target.value)}
          />
        </div>

        {(filters.platformId || filters.planId || filters.dateFrom || filters.dateTo || filters.type !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilters({ page: 1, pageSize: 20, type: "all" })
            }
          >
            {tc("clearSearch")}
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b bg-muted/50">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left font-medium text-muted-foreground"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="py-16 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-16 text-center text-muted-foreground"
                  >
                    {t("noHistory")}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Page {data.page} of {data.totalPages} · {data.totalCount} total records
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setFilters((f) => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))
                }
                disabled={(filters.page ?? 1) <= 1}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(data.totalPages, (f.page ?? 1) + 1),
                  }))
                }
                disabled={(filters.page ?? 1) >= data.totalPages}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
