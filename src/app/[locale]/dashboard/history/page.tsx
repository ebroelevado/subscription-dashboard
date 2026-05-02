"use client";

import { useState, useMemo } from "react";
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
import { formatCurrency, centsToAmount } from "@/lib/currency";
import { useSession } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAll } from "@/lib/invalidate-helpers";
import { downloadCSV } from "@/lib/csv-export";
// We use a native checkbox if the UI component is missing
const Checkbox = ({ checked, onCheckedChange, className }: any) => (
  <input
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
    page: 1,
    pageSize: 20,
    type: "all",
  });

  // Edit sheet state
  const [editingRow, setEditingRow] = useState<HistoryRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkFixing, setIsBulkFixing] = useState(false);
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

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === (data?.rows.length ?? 0) && selectedIds.size > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data?.rows.map((r) => r.id) ?? []));
    }
  };

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
    } catch (err) {
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
    [t, selectedIds, data],
  );

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
      <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search bar */}
          <div className="relative flex-1 min-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={tc("searchPlaceholder")}
              className="pl-9"
              value={filters.search ?? ""}
              onChange={(e) => updateFilter("search", e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            {(filters.platformId ||
              filters.planId ||
              filters.dateFrom ||
              filters.dateTo ||
              filters.search ||
              filters.type !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => setFilters({ page: 1, pageSize: 20, type: "all" })}
              >
                <XCircle className="mr-2 size-4" />
                {tc("clearSearch")}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-muted/50">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <Select value={filters.type ?? "all"} onValueChange={(v) => updateFilter("type", v)}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allTypes")}</SelectItem>
                <SelectItem value="income">{t("income")}</SelectItem>
                <SelectItem value="cost">{t("expense")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="h-4 w-px bg-muted mx-1" />

          <div className="flex items-center gap-3">
            <Select
              value={filters.platformId ?? "all"}
              onValueChange={(v) => updateFilter("platformId", v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-36 h-8 text-xs">
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
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder={tc("allPlans")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tc("allPlans")}</SelectItem>
                {plans?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="h-4 w-px bg-muted mx-1" />

          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                className="w-32 h-8 text-xs p-1"
                value={filters.dateFrom ?? ""}
                onChange={(e) => updateFilter("dateFrom", e.target.value)}
              />
              <span className="text-muted-foreground">→</span>
              <Input
                type="date"
                className="w-32 h-8 text-xs p-1"
                value={filters.dateTo ?? ""}
                onChange={(e) => updateFilter("dateTo", e.target.value)}
              />
            </div>

            <Select 
              onValueChange={(v) => {
                const now = new Date();
                let from = "";
                let to = now.toISOString().split("T")[0];
                
                if (v === "today") {
                  from = to;
                } else if (v === "yesterday") {
                  const yesterday = new Date(now);
                  yesterday.setDate(now.getDate() - 1);
                  from = yesterday.toISOString().split("T")[0];
                  to = from;
                } else if (v === "last7") {
                  const last7 = new Date(now);
                  last7.setDate(now.getDate() - 7);
                  from = last7.toISOString().split("T")[0];
                } else if (v === "thisMonth") {
                  from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
                } else if (v === "lastMonth") {
                  from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
                  to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
                }
                
                setFilters(prev => ({ ...prev, dateFrom: from, dateTo: to, page: 1 }));
              }}
            >
              <SelectTrigger className="w-8 h-8 p-0 border-none bg-muted/30 hover:bg-muted/50 transition-colors">
                <span className="sr-only">Quick range</span>
                <ChevronDown className="size-3 text-muted-foreground mx-auto" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="today">{tc("today")}</SelectItem>
                <SelectItem value="yesterday">{tc("yesterday")}</SelectItem>
                <SelectItem value="last7">{tc("last7Days")}</SelectItem>
                <SelectItem value="thisMonth">{tc("thisMonth")}</SelectItem>
                <SelectItem value="lastMonth">{tc("lastMonth")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))}
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
