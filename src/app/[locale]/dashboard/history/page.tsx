"use client";

import { useCallback, useState, useMemo, type ComponentPropsWithoutRef } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  useAnalyticsHistory,
  useUpdateHistoryEntry,
  useDeleteHistoryEntry,
  undoHistoryMutation,
  type HistoryRow,
  type HistoryFilters,
} from "@/hooks/use-analytics";
import { usePlatforms } from "@/hooks/use-platforms";
import { usePlans } from "@/hooks/use-plans";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { useClients } from "@/hooks/use-clients";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ArrowUpCircle,
  ArrowDownCircle,
  Loader2,
  Trash2,
  AlertTriangle,
  ChevronDown,
  XCircle,
  Search,
  Calendar,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EditEntrySheet, type EditDraft } from "@/components/history/edit-entry-sheet";
import { formatCurrency } from "@/lib/currency";
import { useSession } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAll } from "@/lib/invalidate-helpers";
import { downloadCSV } from "@/lib/csv-export";
// We use a native checkbox if the UI component is missing
type CheckboxProps = Omit<ComponentPropsWithoutRef<"input">, "onChange" | "type"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

const Checkbox = ({ checked, onCheckedChange, className, ...props }: CheckboxProps) => (
  <input
    {...props}
    type="checkbox"
    checked={checked}
    onChange={(e) => onCheckedChange(e.target.checked)}
    className={cn("size-4 rounded border-gray-300 text-primary focus:ring-primary", className)}
  />
);
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const columnHelper = createColumnHelper<HistoryRow>();

const AUTO_EDIT_REASON = "Refactorización History";
const DEFAULT_FILTERS: HistoryFilters = { page: 1, pageSize: 20, type: "all" };

type QuickRange =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "last90"
  | "thisMonth"
  | "lastMonth";

type PageItem = number | "start-ellipsis" | "end-ellipsis";

function formatDateInput(date: Date) {
  return date.toISOString().split("T")[0];
}

function getQuickRange(range: QuickRange) {
  const now = new Date();
  let from = "";
  let to = formatDateInput(now);

  if (range === "today") {
    from = to;
  } else if (range === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    from = formatDateInput(yesterday);
    to = from;
  } else if (range === "last7") {
    const last7 = new Date(now);
    last7.setDate(now.getDate() - 7);
    from = formatDateInput(last7);
  } else if (range === "last30") {
    const last30 = new Date(now);
    last30.setDate(now.getDate() - 30);
    from = formatDateInput(last30);
  } else if (range === "last90") {
    const last90 = new Date(now);
    last90.setDate(now.getDate() - 90);
    from = formatDateInput(last90);
  } else if (range === "thisMonth") {
    from = formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  } else if (range === "lastMonth") {
    from = formatDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    to = formatDateInput(new Date(now.getFullYear(), now.getMonth(), 0));
  }

  return { from, to };
}

function getPaginationItems(currentPage: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "end-ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, "start-ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "start-ellipsis", currentPage - 1, currentPage, currentPage + 1, "end-ellipsis", totalPages];
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
          : "text-red-600 dark:text-red-400",
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
    ...DEFAULT_FILTERS,
  });

  // Edit sheet state
  const [editingRow, setEditingRow] = useState<HistoryRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data, isLoading } = useAnalyticsHistory(filters);
  const { data: platforms } = usePlatforms();
  const { data: plans } = usePlans();
  const { data: subscriptions } = useSubscriptions();
  const { data: clients } = useClients();

  const updateHistoryEntry = useUpdateHistoryEntry();
  const deleteHistoryEntry = useDeleteHistoryEntry();

  // Memoized options for the edit sheet
  const platformOptions = useMemo(() => {
    return (platforms ?? []).map((p) => ({ id: p.id, label: p.name }));
  }, [platforms]);

  const planOptionsByPlatform = useMemo(() => {
    const grouped: Record<string, { id: string; label: string }[]> = {};
    for (const p of plans ?? []) {
      if (!grouped[p.platformId]) grouped[p.platformId] = [];
      grouped[p.platformId].push({ id: p.id, label: p.name });
    }
    return grouped;
  }, [plans]);

  const subscriptionOptionsByPlan = useMemo(() => {
    const grouped: Record<string, { id: string; label: string; ownerId: string | null }[]> = {};
    for (const s of subscriptions ?? []) {
      if (!grouped[s.planId]) grouped[s.planId] = [];
      grouped[s.planId].push({ id: s.id, label: s.label, ownerId: s.ownerId ?? null });
    }
    return grouped;
  }, [subscriptions]);

  const subscriptionsById = useMemo(() => {
    const map: Record<string, { ownerId: string | null }> = {};
    for (const s of subscriptions ?? []) {
      map[s.id] = { ownerId: s.ownerId ?? null };
    }
    return map;
  }, [subscriptions]);

  const seatOptionsBySubscription = useMemo(() => {
    const grouped: Record<string, { clientId: string; clientName: string; clientSubscriptionId: string }[]> = {};
    for (const row of data?.rows ?? []) {
      if (row.type === "income" && row.clientId && row.clientName && row.clientSubscriptionId) {
        if (!grouped[row.subscriptionId]) grouped[row.subscriptionId] = [];
        if (!grouped[row.subscriptionId].some((s) => s.clientId === row.clientId)) {
          grouped[row.subscriptionId].push({
            clientId: row.clientId,
            clientName: row.clientName,
            clientSubscriptionId: row.clientSubscriptionId,
          });
        }
      }
    }
    return grouped;
  }, [data?.rows]);

  const ownerOptionsByPlan = useMemo(() => {
    const nameById = new Map((clients ?? []).map((c) => [c.id, c.name]));
    const grouped: Record<string, { id: string; label: string }[]> = {};
    for (const sub of subscriptions ?? []) {
      if (!sub.ownerId) continue;
      if (!grouped[sub.planId]) grouped[sub.planId] = [];
      if (!grouped[sub.planId].some((o) => o.id === sub.ownerId)) {
        grouped[sub.planId].push({ id: sub.ownerId, label: nameById.get(sub.ownerId) ?? "Deleted Client" });
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

  const handleSave = async (row: HistoryRow, draft: EditDraft) => {
    const amountPaid = parseFloat(draft.amountPaid);
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      toast.error(t("editError"));
      return;
    }

    if (draft.type === "income" && !draft.clientSubscriptionId) {
      toast.error(t("editError"));
      return;
    }

    if (draft.type === "cost" && !draft.subscriptionId) {
      toast.error(t("editError"));
      return;
    }

    setIsSaving(true);
    try {
      const response = await updateHistoryEntry.mutateAsync({
        id: row.id,
        type: row.type,
        nextType: draft.type !== row.type ? draft.type : undefined,
        reason: AUTO_EDIT_REASON,
        amountPaid,
        paidOn: draft.paidOn,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        notes: draft.notes.trim() ? draft.notes.trim() : null,
        subscriptionId: draft.subscriptionId || undefined,
        clientSubscriptionId:
          draft.type === "income" ? (draft.clientSubscriptionId ?? undefined) : undefined,
      });

      setEditingRow(null);
      toast.success(t("editSuccess"), {
        action: {
          label: t("undo"),
          onClick: () => void handleUndo(response.auditLogId),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("editError"));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === (data?.rows.length ?? 0) && selectedIds.size > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data?.rows.map((r) => r.id) ?? []));
    }
  }, [data?.rows, selectedIds.size]);

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      let successCount = 0;

      for (const id of idsToDelete) {
        const row = data?.rows.find((r) => r.id === id);
        if (!row) continue;
        
        try {
          await deleteHistoryEntry.mutateAsync({
            id: row.id,
            type: row.type,
            reason: "Bulk delete from history table",
          });
          successCount++;
        } catch (err) {
          console.error(`Failed to delete ${id}:`, err);
        }
      }

      toast.success(t("deleteSuccessCount", { count: successCount }));
      setSelectedIds(new Set());
      setShowDeleteDialog(false);
    } catch {
      toast.error(t("deleteError"));
    } finally {
      setIsBulkDeleting(false);
    }
  };


  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: () => (
          <Checkbox
            checked={selectedIds.size === (data?.rows.length ?? 0) && (data?.rows.length ?? 0) > 0}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.has(row.original.id)}
            onCheckedChange={() => toggleSelection(row.original.id)}
            aria-label="Select row"
          />
        ),
      }),
      columnHelper.accessor("clientName", {
        header: t("client"),
        cell: (info) => info.getValue() ?? "—",
      }),
      columnHelper.accessor("type", {
        header: t("type"),
        cell: (info) => {
          const type = info.getValue();
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                type === "income"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
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
        cell: ({ row }) => (
          <AmountCell amount={Number(row.getValue("amount"))} type={row.original.type} />
        ),
      }),
      columnHelper.accessor("platform", {
        header: t("platform"),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("plan", {
        header: t("plan"),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("subscriptionLabel", {
        header: t("subscription"),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("paidOn", {
        header: t("date"),
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("periodStart", {
        header: t("period"),
        cell: (info) => (
          <span className="tabular-nums text-muted-foreground text-xs">
            {info.getValue()} → {info.row.original.periodEnd}
          </span>
        ),
      }),
      columnHelper.accessor("notes", {
        header: t("notes"),
        cell: (info) => {
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
    ],
    [t, selectedIds, data, toggleAll, toggleSelection],
  );

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const selectedPlatformName = platforms?.find((p) => p.id === filters.platformId)?.name;
  const selectedPlanName = plans?.find((p) => p.id === filters.planId)?.name;
  const selectedSubscriptionName = subscriptions?.find((s) => s.id === filters.subscriptionId)?.label;
  const selectedClientName = clients?.find((c) => c.id === filters.clientId)?.name;

  const hasActiveFilters = Boolean(
    filters.platformId ||
      filters.planId ||
      filters.subscriptionId ||
      filters.clientId ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.search ||
      filters.type !== "all",
  );

  const activeFilterChips = [
    filters.search ? { key: "search", label: `${tc("search")}: ${filters.search}` } : null,
    filters.type && filters.type !== "all"
      ? { key: "type", label: `${t("type")}: ${filters.type === "income" ? t("income") : t("expense")}` }
      : null,
    filters.platformId ? { key: "platformId", label: `${t("platform")}: ${selectedPlatformName ?? filters.platformId}` } : null,
    filters.planId ? { key: "planId", label: `${t("plan")}: ${selectedPlanName ?? filters.planId}` } : null,
    filters.subscriptionId
      ? { key: "subscriptionId", label: `${t("subscription")}: ${selectedSubscriptionName ?? filters.subscriptionId}` }
      : null,
    filters.clientId ? { key: "clientId", label: `${t("client")}: ${selectedClientName ?? filters.clientId}` } : null,
    filters.dateFrom ? { key: "dateFrom", label: `${t("date")}: ≥ ${filters.dateFrom}` } : null,
    filters.dateTo ? { key: "dateTo", label: `${t("date")}: ≤ ${filters.dateTo}` } : null,
  ].filter((chip): chip is { key: keyof HistoryFilters; label: string } => chip !== null);

  const updateFilter = (key: keyof HistoryFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
      page: key !== "page" ? 1 : prev.page,
    }));
  };

  const clearFilter = (key: keyof HistoryFilters) => {
    setFilters((prev) => ({
      ...prev,
      [key]: key === "type" ? "all" : undefined,
      page: 1,
    }));
  };

  const applyQuickRange = (range: QuickRange) => {
    const { from, to } = getQuickRange(range);
    setFilters((prev) => ({ ...prev, dateFrom: from, dateTo: to, page: 1 }));
  };

  const handleExport = () => {
    if (!data?.rows.length) return;
    downloadCSV(
      data.rows.map((r) => ({
        Date: r.paidOn,
        Type: r.type,
        Amount: r.amount / 100,
        Platform: r.platform,
        Plan: r.plan,
        Subscription: r.subscriptionLabel,
        Client: r.clientName ?? "",
        PeriodStart: r.periodStart,
        PeriodEnd: r.periodEnd,
        Notes: r.notes === "platform_payment" ? t("platformPayment") : (r.notes ?? ""),
      })),
      `ledger-${new Date().toISOString().split("T")[0]}`,
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-lg border animate-in fade-in slide-in-from-right-4">
              <span className="text-xs font-medium mr-2 text-muted-foreground">{selectedIds.size} {tc("selected") || "seleccionados"}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowDeleteDialog(true)}
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? <Loader2 className="size-3 animate-spin mr-1" /> : <Trash2 className="size-3 mr-1" />}
                {tc("delete")}
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!data?.rows.length}
            className="gap-2 border-primary/20 hover:bg-primary/5 hover:border-primary/30 transition-all active:scale-95"
          >
            <Download className="size-4 text-primary" />
            <span>{t("exportCsv")}</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card/95 p-3 shadow-sm transition-all duration-200">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={tc("searchPlaceholder")}
              className="h-9 pl-9 text-sm transition-all focus-visible:ring-primary/30"
              value={filters.search ?? ""}
              onChange={(e) => updateFilter("search", e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.type ?? "all"} onValueChange={(v) => updateFilter("type", v)}>
              <SelectTrigger className="h-9 w-[132px] text-xs transition-colors">
                <Filter className="mr-2 size-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allTypes")}</SelectItem>
                <SelectItem value="income">{t("income")}</SelectItem>
                <SelectItem value="cost">{t("expense")}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.platformId ?? "all"}
              onValueChange={(v) => updateFilter("platformId", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-9 w-[145px] text-xs transition-colors">
                <SelectValue placeholder={tc("allPlatforms")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tc("allPlatforms")}</SelectItem>
                {platforms?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.planId ?? "all"}
              onValueChange={(v) => updateFilter("planId", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-9 w-[145px] text-xs transition-colors">
                <SelectValue placeholder={tc("allPlans")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tc("allPlans")}</SelectItem>
                {plans?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.subscriptionId ?? "all"}
              onValueChange={(v) => updateFilter("subscriptionId", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-9 w-[160px] text-xs transition-colors">
                <SelectValue placeholder={tc("subscriptions")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tc("subscriptions")}</SelectItem>
                {subscriptions?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.clientId ?? "all"}
              onValueChange={(v) => updateFilter("clientId", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-9 w-[150px] text-xs transition-colors">
                <SelectValue placeholder={tc("clients")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tc("clients")}</SelectItem>
                {clients?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 transition-colors focus-within:ring-2 focus-within:ring-primary/30">
              <Calendar className="size-3.5 text-muted-foreground" />
              <Input
                type="date"
                className="h-7 w-[122px] border-0 p-0 text-xs shadow-none focus-visible:ring-0"
                value={filters.dateFrom ?? ""}
                onChange={(e) => updateFilter("dateFrom", e.target.value)}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                className="h-7 w-[122px] border-0 p-0 text-xs shadow-none focus-visible:ring-0"
                value={filters.dateTo ?? ""}
                onChange={(e) => updateFilter("dateTo", e.target.value)}
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 text-xs transition-all active:scale-95">
                  <Calendar className="size-3.5" />
                  Quick Range
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Quick Range</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => applyQuickRange("today")}>{tc("today")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyQuickRange("yesterday")}>{tc("yesterday")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyQuickRange("last7")}>{tc("last7Days")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyQuickRange("last30")}>Last 30 days</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyQuickRange("last90")}>Last 90 days</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyQuickRange("thisMonth")}>{tc("thisMonth")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyQuickRange("lastMonth")}>{tc("lastMonth")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setFilters({ ...DEFAULT_FILTERS })}
              >
                <XCircle className="mr-2 size-4" />
                {tc("clearSearch")}
              </Button>
            )}
          </div>
        </div>

        {activeFilterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-muted/60 pt-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
            {activeFilterChips.map((chip) => (
              <Badge key={chip.key} variant="outline" className="gap-1.5 rounded-full border-dashed bg-muted/30 px-2 py-1 font-medium">
                {chip.label}
                <button
                  type="button"
                  className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => clearFilter(chip.key)}
                  aria-label={`Remove ${chip.label}`}
                >
                  <XCircle className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b bg-muted/40">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
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
                    onClick={() => setEditingRow(row.original)}
                    className={cn(
                      "border-b last:border-0 transition-colors cursor-pointer even:bg-muted/20",
                      selectedIds.has(row.original.id) ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td 
                        key={cell.id} 
                        className="px-4 py-3"
                        onClick={(e) => {
                          if (cell.column.id === "select") {
                            e.stopPropagation();
                          }
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8 transition-all active:scale-95"
                onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))}
                disabled={(filters.page ?? 1) <= 1}
              >
                <ChevronLeft className="size-4" />
              </Button>
              {getPaginationItems(data.page, data.totalPages).map((item) =>
                typeof item === "number" ? (
                  <Button
                    key={item}
                    variant={item === data.page ? "default" : "outline"}
                    size="sm"
                    className="size-8 px-0 text-xs transition-all active:scale-95"
                    onClick={() => setFilters((f) => ({ ...f, page: item }))}
                    aria-current={item === data.page ? "page" : undefined}
                  >
                    {item}
                  </Button>
                ) : (
                  <span key={item} className="flex size-8 items-center justify-center text-xs text-muted-foreground">
                    …
                  </span>
                ),
              )}
              <Button
                variant="outline"
                size="icon"
                className="size-8 transition-all active:scale-95"
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

      {/* Edit Sheet */}
      <EditEntrySheet
        row={editingRow}
        open={editingRow !== null}
        onOpenChange={(open) => { if (!open) setEditingRow(null); }}
        onSave={handleSave}
        isSaving={isSaving}
        platformOptions={platformOptions}
        planOptionsByPlatform={planOptionsByPlatform}
        subscriptionOptionsByPlan={subscriptionOptionsByPlan}
        seatOptionsBySubscription={seatOptionsBySubscription}
        ownerOptionsByPlan={ownerOptionsByPlan}
        subscriptionsById={subscriptionsById}
      />

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-600" />
              {tc("confirmDelete")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que quieres eliminar {selectedIds.size} registros? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                handleBulkDelete();
              }}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
