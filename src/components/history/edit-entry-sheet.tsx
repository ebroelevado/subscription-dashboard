"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import type { HistoryRow } from "@/hooks/use-analytics";

const NONE = "__none__";

export type EditDraft = {
  type: "income" | "cost";
  amountPaid: string; // decimal string, e.g. "5.00"
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

type SelectOption = { id: string; label: string };
type SubscriptionOption = { id: string; label: string; ownerId: string | null };
type SeatOption = { clientId: string; clientName: string; clientSubscriptionId: string };

interface EditEntrySheetProps {
  row: HistoryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (row: HistoryRow, draft: EditDraft) => Promise<void>;
  isSaving: boolean;
  platformOptions: SelectOption[];
  planOptionsByPlatform: Record<string, SelectOption[]>;
  subscriptionOptionsByPlan: Record<string, SubscriptionOption[]>;
  seatOptionsBySubscription: Record<string, SeatOption[]>;
  ownerOptionsByPlan: Record<string, SelectOption[]>;
  subscriptionsById: Record<string, { ownerId?: string | null }>;
}

function notesForDraft(notes: string | null): string {
  return notes === "platform_payment" ? "" : (notes ?? "");
}

function initDraft(row: HistoryRow): EditDraft {
  return {
    type: row.type,
    // row.amount is in cents — convert to decimal for display
    amountPaid: (row.amount / 100).toFixed(2),
    paidOn: row.paidOn,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    notes: notesForDraft(row.notes),
    platformId: row.platformId ?? "",
    planId: row.planId ?? "",
    subscriptionId: row.subscriptionId,
    clientId: row.clientId ?? "",
    clientSubscriptionId: row.clientSubscriptionId,
  };
}

export function EditEntrySheet({
  row,
  open,
  onOpenChange,
  onSave,
  isSaving,
  platformOptions,
  planOptionsByPlatform,
  subscriptionOptionsByPlan,
  seatOptionsBySubscription,
  ownerOptionsByPlan,
  subscriptionsById,
}: EditEntrySheetProps) {
  const t = useTranslations("history");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<EditDraft | null>(null);

  // Reset draft whenever the target row changes
  useEffect(() => {
    if (row) setDraft(initDraft(row));
  }, [row]);

  const set = (field: keyof EditDraft, value: string) =>
    setDraft((prev) => prev ? { ...prev, [field]: value } : prev);

  // Cascade: platform → plan → subscription → client
  const changeRelation = (
    field: "platformId" | "planId" | "subscriptionId" | "clientId",
    value: string,
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next: EditDraft = { ...prev, [field]: value };

      if (field === "platformId") {
        const plans = planOptionsByPlatform[value] ?? [];
        if (!plans.some((p) => p.id === next.planId)) next.planId = plans[0]?.id ?? "";
        const subs = subscriptionOptionsByPlan[next.planId] ?? [];
        if (!subs.some((s) => s.id === next.subscriptionId)) next.subscriptionId = subs[0]?.id ?? "";
        syncClient(next);
      } else if (field === "planId") {
        const subs = subscriptionOptionsByPlan[value] ?? [];
        if (!subs.some((s) => s.id === next.subscriptionId)) next.subscriptionId = subs[0]?.id ?? "";
        syncClient(next);
      } else if (field === "subscriptionId") {
        syncClient(next);
      } else if (field === "clientId") {
        if (next.type === "income") {
          const seat = (seatOptionsBySubscription[next.subscriptionId] ?? []).find(
            (s) => s.clientId === value,
          );
          next.clientId = seat?.clientId ?? value;
          next.clientSubscriptionId = seat?.clientSubscriptionId ?? null;
        } else {
          next.clientId = value;
          next.clientSubscriptionId = null;
          const matchSub = (subscriptionOptionsByPlan[next.planId] ?? []).find(
            (s) => s.ownerId === value,
          );
          if (matchSub) next.subscriptionId = matchSub.id;
        }
      }

      return next;
    });
  };

  const syncClient = (next: EditDraft) => {
    if (next.type === "income") {
      const seats = seatOptionsBySubscription[next.subscriptionId] ?? [];
      const seat = seats.find((s) => s.clientId === next.clientId) ?? seats[0];
      next.clientId = seat?.clientId ?? "";
      next.clientSubscriptionId = seat?.clientSubscriptionId ?? null;
    } else {
      const sub = subscriptionsById[next.subscriptionId];
      next.clientId = sub?.ownerId ?? "";
      next.clientSubscriptionId = null;
    }
  };

  const changeType = (value: "income" | "cost") => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next: EditDraft = { ...prev, type: value };
      syncClient(next);
      return next;
    });
  };

  const clientOptions = useMemo(() => {
    if (!draft) return [];
    return draft.type === "income"
      ? (seatOptionsBySubscription[draft.subscriptionId] ?? []).map((s) => ({
          id: s.clientId,
          label: s.clientName,
        }))
      : (ownerOptionsByPlan[draft.planId] ?? []);
  }, [draft?.type, draft?.subscriptionId, draft?.planId, seatOptionsBySubscription, ownerOptionsByPlan]);

  const planOptions = planOptionsByPlatform[draft?.platformId ?? ""] ?? [];
  const subOptions = subscriptionOptionsByPlan[draft?.planId ?? ""] ?? [];

  if (!row || !draft) return null;

  const handleSave = async () => {
    await onSave(row, draft);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetTitle>{t("editEntry")}</SheetTitle>
        <SheetDescription className="sr-only">{t("editEntry")}</SheetDescription>

        <div className="mt-6 space-y-5">
          {/* Type */}
          <div className="space-y-1.5">
            <Label>{t("type")}</Label>
            <Select value={draft.type} onValueChange={(v) => changeType(v as "income" | "cost")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">{t("income")}</SelectItem>
                <SelectItem value="cost">{t("expense")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label>{t("amount")}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={draft.amountPaid}
              onChange={(e) => set("amountPaid", e.target.value)}
              inputMode="decimal"
            />
          </div>

          {/* Paid on */}
          <div className="space-y-1.5">
            <Label>{t("date")}</Label>
            <Input
              type="date"
              value={draft.paidOn}
              onChange={(e) => set("paidOn", e.target.value)}
            />
          </div>

          {/* Period */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("period")} (start)</Label>
              <Input
                type="date"
                value={draft.periodStart}
                onChange={(e) => set("periodStart", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("to")}</Label>
              <Input
                type="date"
                value={draft.periodEnd}
                onChange={(e) => set("periodEnd", e.target.value)}
              />
            </div>
          </div>

          {/* Platform */}
          <div className="space-y-1.5">
            <Label>{t("platform")}</Label>
            <Select
              value={draft.platformId || NONE}
              onValueChange={(v) => { if (v !== NONE) changeRelation("platformId", v); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {platformOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Plan */}
          <div className="space-y-1.5">
            <Label>{t("plan")}</Label>
            <Select
              value={draft.planId || NONE}
              onValueChange={(v) => { if (v !== NONE) changeRelation("planId", v); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {planOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subscription */}
          <div className="space-y-1.5">
            <Label>{t("subscription")}</Label>
            <Select
              value={draft.subscriptionId || NONE}
              onValueChange={(v) => { if (v !== NONE) changeRelation("subscriptionId", v); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {subOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Client */}
          <div className="space-y-1.5">
            <Label>{t("client")}</Label>
            <Select
              value={draft.clientId || NONE}
              onValueChange={(v) => { if (v !== NONE) changeRelation("clientId", v); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {clientOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>{t("notes")}</Label>
            <Input
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={t("optionalNotes")}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {tc("cancel")}
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={isSaving}>
              {isSaving ? t("saving") : t("saveChanges")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
