"use client";

import { useState } from "react";
import { useClient } from "@/hooks/use-clients";
import { useRenewClient } from "@/hooks/use-renewals";
import { useDiscipline } from "@/hooks/use-analytics";
import { BulkRenewDialog, type BulkRenewSeat } from "@/components/clients/bulk-renew-dialog";
import { getScoreColor, getScoreLabel } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import {
  Copy, Eye, EyeOff, RefreshCw, MessageCircle, UserCircle, AlertTriangle, Plus,
} from "lucide-react";
import { differenceInDays, startOfDay, addMonths, subMonths, format } from "date-fns";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES, formatCurrency, type Currency } from "@/lib/currency";
import { useLocale, useTranslations } from "next-intl";
import { AssignSubscriptionDialog } from "@/components/clients/assign-subscription-dialog";



type ExpiryStatus = "ok" | "expiring" | "expired";

function getExpiryInfo(activeUntil: string) {
  const today = startOfDay(new Date());
  const expiry = startOfDay(new Date(activeUntil));
  const diff = differenceInDays(expiry, today);

  let status: ExpiryStatus = "ok";
  if (diff < 0) status = "expired";
  else if (diff <= 3) status = "expiring";

  return { diff, status };
}

const expiryBadge: Record<ExpiryStatus, "default" | "secondary" | "destructive"> = {
  ok: "default",
  expiring: "secondary",
  expired: "destructive",
};

import { buildWhatsAppUrl, type Lang } from "@/lib/whatsapp";

interface ClientDetailSheetProps {
  clientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClientDetailSheet({ clientId, open, onOpenChange }: ClientDetailSheetProps) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const tNav = useTranslations("nav");
  const { data: client, isLoading } = useClient(clientId ?? undefined);
  const { data: discipline } = useDiscipline({ clientId: clientId ?? undefined });
  const renewMut = useRenewClient();
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const locale = useLocale();
  const [lang, setLang] = useState<Lang>((locale === "en" || locale === "zh" ? locale : "es") as Lang);
  const [bulkRenewOpen, setBulkRenewOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const { data: session } = useSession();
  const penaltyPerDay = (session?.user as { disciplinePenalty?: number })?.disciplinePenalty ?? 0.5;

  const disciplineScore = discipline?.score ?? null;
  const currency = (session?.user as { currency?: string })?.currency || "EUR";

  // Renew dialog state
  const [renewSeat, setRenewSeat] = useState<{
    id: string;
    customPrice: number;
    activeUntil: string;
    clientName: string;
  } | null>(null);
  const [renewAmount, setRenewAmount] = useState(0);
  const [renewMonths, setRenewMonths] = useState(1);
  const [renewPaidOn, setRenewPaidOn] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [renewNotes, setRenewNotes] = useState("");

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(tc("copied", { label }));
  };

  const openRenewDialog = (seat: {
    id: string;
    customPrice: number;
    activeUntil: string;
  }) => {
    setRenewSeat({
      ...seat,
      clientName: client?.name ?? "Client",
    });
    setRenewAmount(Number(seat.customPrice) / 100);
    setRenewMonths(1);
    setRenewPaidOn(format(new Date(), "yyyy-MM-dd"));
    setRenewNotes("");
  };

  const handleRenewMonthsChange = (newMonths: number) => {
    let clamped = Math.max(-12, Math.min(12, newMonths));
    if (clamped === 0) clamped = newMonths > 0 ? 1 : -1;
    setRenewMonths(clamped);
    const seatPrice = renewSeat ? Number(renewSeat.customPrice) / 100 : 0;
    if (clamped > 0) {
      setRenewAmount(Number((seatPrice * clamped).toFixed(2)));
    } else {
      setRenewAmount(0);
    }
  };

  const handleRenew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewSeat) return;
    renewMut.mutate(
      { seatId: renewSeat.id, amountPaid: renewAmount, months: renewMonths, paidOn: renewPaidOn, notes: renewNotes || null },
      { onSuccess: () => setRenewSeat(null) }
    );
  };

  // Renew preview
  const currentExpiry = renewSeat ? startOfDay(new Date(renewSeat.activeUntil)) : new Date();
  const today = startOfDay(new Date());
  const isRenewCorrection = renewMonths < 0;
  let newExpiry: Date;
  if (isRenewCorrection) {
    newExpiry = subMonths(currentExpiry, Math.abs(renewMonths));
  } else {
    newExpiry = addMonths(currentExpiry, renewMonths);
  }
  const isLapsed = renewSeat ? currentExpiry < today : false;
  const resultInPast = newExpiry < today;

  // Active seats for WhatsApp
  const activeSeats = client?.clientSubscriptions.filter((cs) => cs.status === "active") ?? [];
  const canSendReminder = client?.phone && activeSeats.length > 0;

  const handleSendReminder = () => {
    if (!client?.phone || activeSeats.length === 0) return;
    const waData = activeSeats.map((cs) => ({
      customPrice: Number(cs.customPrice),
      activeUntil: cs.activeUntil,
      platformName: cs.subscription?.plan?.platform?.name ?? "Unknown",
    }));
    const signatureMode = (session?.user as any)?.whatsappSignatureMode ?? "name";
    let senderName = "";
    
    if (signatureMode === "company") {
      senderName = (session?.user as any)?.companyName || session?.user?.name || "";
    } else if (signatureMode === "name") {
      senderName = session?.user?.name || "";
    }
    
    const signature = (signatureMode !== "none" && senderName) 
      ? t("reminderSignature", { sender: senderName }) 
      : "";

    const url = buildWhatsAppUrl(
      client.phone,
      client.name,
      waData,
      lang,
      (key: string, vals?: Record<string, string | number>) => {
        if (key.startsWith("common.")) return tc(key.replace("common.", ""), vals);
        if (key.startsWith("clients.")) return t(key.replace("clients.", ""), vals);
        return key;
      },
      signature,
      currency,
      true // always include ALL seats in the global reminder
    );
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSendReminderForSeat = (cs: typeof activeSeats[number]) => {
    if (!client?.phone) return;
    const waData = [{
      customPrice: Number(cs.customPrice),
      activeUntil: cs.activeUntil,
      platformName: cs.subscription?.plan?.platform?.name ?? "Unknown",
    }];
    const signatureMode = (session?.user as any)?.whatsappSignatureMode ?? "name";
    let senderName = "";
    
    if (signatureMode === "company") {
      senderName = (session?.user as any)?.companyName || session?.user?.name || "";
    } else if (signatureMode === "name") {
      senderName = session?.user?.name || "";
    }
    
    const signature = (signatureMode !== "none" && senderName) 
      ? t("reminderSignature", { sender: senderName }) 
      : "";

    const url = buildWhatsAppUrl(
      client.phone,
      client.name,
      waData,
      lang,
      (key: string, vals?: Record<string, string | number>) => {
        if (key.startsWith("common.")) return tc(key.replace("common.", ""), vals);
        if (key.startsWith("clients.")) return t(key.replace("clients.", ""), vals);
        return key;
      },
      signature,
      currency,
      true // force — always include this single seat regardless of days
    );
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
          <SheetTitle className="sr-only">{t("clientDetail")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("description")}
          </SheetDescription>

          {isLoading || !client ? (
            <div className="space-y-4 pt-8">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-5 pt-2">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center size-10 rounded-full bg-muted">
                    <UserCircle className="size-6 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{client.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {client.phone ?? t("noPhone")} · {client.notes ?? t("noNotes")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Credentials */}
              {(client.serviceUser || client.servicePassword) && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{tc("credentials")}</p>
                  {client.serviceUser && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{tc("username")}</span>
                      <div className="flex items-center gap-1">
                        <code className="font-mono text-sm">{client.serviceUser}</code>
                        <Button variant="ghost" size="icon" className="size-6" onClick={() => copyToClipboard(client.serviceUser!, tc("username"))}>
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {client.servicePassword && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{tc("password")}</span>
                      <div className="flex items-center gap-1">
                        <code className="font-mono text-sm">
                          {showPasswords["global"] ? client.servicePassword : "••••••••"}
                        </code>
                        <Button variant="ghost" size="icon" className="size-6"
                          onClick={() => setShowPasswords((p) => ({ ...p, global: !p.global }))}>
                          {showPasswords["global"] ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="size-6" onClick={() => copyToClipboard(client.servicePassword!, tc("password"))}>
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* WhatsApp Reminder */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 bg-[#25D366]/10 text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366] hover:text-white hover:border-[#25D366] dark:bg-[#25D366]/15 dark:hover:bg-[#25D366] transition-all duration-200 hover:scale-[1.02] hover:shadow-md hover:shadow-[#25D366]/20"
                  onClick={handleSendReminder}
                  disabled={!canSendReminder}
                >
                  <MessageCircle className="mr-2 size-4" />
                  {activeSeats.length > 1 ? t("sendReminders") : t("sendReminder")}
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="font-mono text-xs"
                        onClick={() => {
                          if (lang === "es") setLang("en");
                          else if (lang === "en") setLang("zh");
                          else setLang("es");
                        }}
                      >
                        {lang === "es" ? "🇪🇸 ES" : lang === "en" ? "🇬🇧 EN" : "🇨🇳 ZH"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {tc("changeLanguage")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {!canSendReminder && client.phone && activeSeats.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("noActiveSeatsToRemind")}</p>
              )}
              {!client.phone && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t("addPhoneWarning")}</p>
              )}

              {/* Seats */}
              <div className="space-y-3">
                {/* Full-width action buttons row */}
                <div className="flex gap-2">
                  {activeSeats.length >= 2 && (
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={() => setBulkRenewOpen(true)}
                    >
                      <RefreshCw className="mr-1.5 size-3" />
                      {t("renewAll")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8 text-xs"
                    onClick={() => setAssignDialogOpen(true)}
                  >
                    <Plus className="mr-1.5 size-3" />
                    {t("assignSubscription")}
                  </Button>
                </div>

                {/* Seats count label & Discipline Score */}
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {t("seatsSection")} ({client.clientSubscriptions.length})
                  </p>
                  {disciplineScore !== null && discipline && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 cursor-help">
                            <span className="text-sm font-medium text-muted-foreground">
                              {t("disciplineScore")}:
                            </span>
                            <span className={`text-sm font-bold font-mono ${getScoreColor(Number(disciplineScore))}`}>
                              {Number(disciplineScore).toFixed(1)}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          <p>{t("avgDaysLateLabel")}: {discipline.avgDaysLate}d</p>
                          <p>{t("onTimeRateLabel")}: {discipline.onTimeRate}%</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>

                {client.clientSubscriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noActiveSeats")}</p>
                ) : (
                  client.clientSubscriptions.map((cs) => {
                    const expiry = getExpiryInfo(cs.activeUntil);
                    const isPaused = cs.status === "paused";



                    return (
                      <div
                        key={cs.id}
                        className={`rounded-lg border p-3 space-y-2 transition-colors ${isPaused
                            ? "opacity-80 bg-amber-50/30 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                            : ""
                          }`}
                      >
                        {/* Service info */}
                        <div className="flex items-center justify-between">
                          <div>
                            <Link
                              href={`/dashboard/subscriptions/${cs.subscription?.id ?? ""}`}
                              className="text-sm font-medium hover:underline"
                              onClick={(e) => {
                                if (!cs.subscription) e.preventDefault();
                                else onOpenChange(false);
                              }}
                            >
                              {cs.subscription?.plan?.platform?.name ?? "Deleted"} — {cs.subscription?.plan?.name ?? "Deleted"}
                            </Link>
                            <p className="text-xs text-muted-foreground">{cs.subscription?.label ?? "Deleted"}</p>
                          </div>
                          <Badge variant={
                            cs.status === "active" ? "default" : "secondary"
                          } className="text-[10px] h-5">
                            {tc(cs.status)}
                          </Badge>
                        </div>

                        {/* Price & Expiry */}
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-mono">{formatCurrency(Number(cs.customPrice), currency)}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">
                              {isPaused
                                ? tc("paused")
                                : expiry.diff < 0
                                  ? tc("daysOverdue", { count: Math.abs(expiry.diff) })
                                  : expiry.diff === 0
                                    ? tc("today")
                                    : tc("daysLeft", { count: expiry.diff })}
                            </span>
                            <Badge variant={isPaused ? "secondary" : expiryBadge[expiry.status]} className="text-[10px]">
                              {format(new Date(cs.activeUntil), "dd/MM/yyyy")}
                            </Badge>
                          </div>
                        </div>

                        {/* Renew button — only for active seats */}
                        {cs.status === "active" && (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => openRenewDialog({
                                id: cs.id,
                                customPrice: Number(cs.customPrice),
                                activeUntil: cs.activeUntil,
                              })}
                            >
                              <RefreshCw className="mr-2 size-3.5" />
                              {t("renewSeat")}
                            </Button>
                            {client?.phone && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0 bg-[#25D366]/10 text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366] hover:text-white hover:border-[#25D366] transition-all duration-200"
                                onClick={() => handleSendReminderForSeat(cs)}
                              >
                                <MessageCircle className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Recent renewals */}
                        {cs.renewalLogs.length > 0 && (
                          <div className="border-t pt-2 mt-1">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                              {tNav("history")}
                            </p>
                            {cs.renewalLogs.slice(0, 3).map((r) => (
                              <div key={r.id} className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{format(new Date(r.paidOn), "dd/MM/yyyy")}</span>
                                <span className="font-mono">{formatCurrency(Number(r.amountPaid), currency)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Renew Dialog */}
      <Dialog open={!!renewSeat} onOpenChange={(o) => { if (!o) setRenewSeat(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(isRenewCorrection ? tc("correction") : t("renewSeat"))} — {renewSeat?.clientName ?? ""}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenew} className="space-y-4">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="renew-amount">
                {tc("amountPaid")} ({CURRENCIES[currency as Currency || "EUR"].symbol})
              </Label>
              <Input
                id="renew-amount"
                type="number"
                step="0.01"
                value={renewAmount}
                onChange={(e) => setRenewAmount(Number(e.target.value))}
              />
              {renewMonths > 1 && renewSeat && (
                <p className="text-xs text-muted-foreground">
                  {tc("autoCalculated")}: {Number(renewSeat.customPrice).toFixed(2)} × {renewMonths} {t("renewMonths")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="renew-months">{t("renewMonths")}</Label>
              <Input
                id="renew-months"
                type="number"
                min={-12}
                max={12}
                value={renewMonths}
                onChange={(e) => handleRenewMonthsChange(Number(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                {tc("renewMonthsHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="renew-paidon">{tc("paymentDate")}</Label>
              <Input
                id="renew-paidon"
                type="date"
                value={renewPaidOn}
                onChange={(e) => setRenewPaidOn(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="renew-notes">{tc("notes")} ({tc("optional")})</Label>
              <Input
                id="renew-notes"
                value={renewNotes}
                onChange={(e) => setRenewNotes(e.target.value)}
                placeholder={tc("notesPlaceholder")}
              />
            </div>

            {/* Preview */}
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{tc("currentExpiry")}</span>
                <span className={isLapsed ? "text-destructive font-medium" : ""}>
                  {format(currentExpiry, "dd/MM/yyyy")}
                  {isLapsed && ` (${tc("lapsed")})`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{tc("newExpiry")}</span>
                <span className={`font-semibold ${resultInPast ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                  {format(newExpiry, "dd/MM/yyyy")}
                </span>
              </div>
            </div>

            {resultInPast && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <span>{tc("resultInPastWarning")}</span>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenewSeat(null)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={renewMut.isPending} variant={isRenewCorrection ? "destructive" : "default"}>
                {renewMut.isPending ? tc("saving") : isRenewCorrection ? tc("applyCorrection") : tc("confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Renew Dialog */}
      {client && (
        <BulkRenewDialog
          open={bulkRenewOpen}
          onOpenChange={setBulkRenewOpen}
          clientName={client.name}
          seats={client.clientSubscriptions.map((cs): BulkRenewSeat => ({
            id: cs.id,
            customPrice: Number(cs.customPrice),
            activeUntil: cs.activeUntil,
            status: cs.status,
            platformName: cs.subscription?.plan?.platform?.name ?? "Deleted",
            planName: cs.subscription?.plan?.name ?? "Deleted",
            subscriptionLabel: cs.subscription?.label ?? "Deleted",
          }))}
        />
      )}

      {/* Assign Subscription Dialog */}
      {client && (
        <AssignSubscriptionDialog
          clientId={client.id}
          clientName={client.name}
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
        />
      )}
    </>
  );
}
