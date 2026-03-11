"use client";

import { useState, useMemo } from "react";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { useCreateSeat } from "@/hooks/use-seats";
import { useSession } from "next-auth/react";
import { CURRENCIES, type Currency } from "@/lib/currency";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Plus, Eye, EyeOff, ChevronRight, ChevronDown } from "lucide-react";
import { addMonths, format } from "date-fns";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";

interface AssignSubscriptionDialogProps {
  clientId: string;
  clientName: string;
  previousServiceUser?: string | null;
  previousServicePassword?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignSubscriptionDialog({ 
  clientId, 
  clientName,
  previousServiceUser,
  previousServicePassword,
  open, 
  onOpenChange 
}: AssignSubscriptionDialogProps) {
  const createSeat = useCreateSeat();
  const { data: subscriptions } = useSubscriptions();
  const { data: session } = useSession();
  const t = useTranslations("clients");
  const tc = useTranslations("common");

  // Form state
  const [search, setSearch] = useState("");
  const [selectedSubId, setSelectedSubId] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [durationMonths, setDurationMonths] = useState("1");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [serviceUser, setServiceUser] = useState(previousServiceUser || "");
  const [servicePassword, setServicePassword] = useState(previousServicePassword || "");
  const [showPassword, setShowPassword] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [paymentNote, setPaymentNote] = useState("");

  // Collapsible states
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({});
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({});

  const togglePlatform = (pName: string) => {
    setExpandedPlatforms(prev => ({ ...prev, [pName]: !prev[pName] }));
  };

  const togglePlan = (pKey: string) => {
    setExpandedPlans(prev => ({ ...prev, [pKey]: !prev[pKey] }));
  };

  // Grouping logic
  const groupedSubs = useMemo(() => {
    if (!subscriptions) return [];
    
    // Filter first
    let filtered = subscriptions;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = subscriptions.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.plan.platform.name.toLowerCase().includes(q) ||
          s.plan.name.toLowerCase().includes(q)
      );
    }

    // Group by platform -> plan
    const grouped = new Map<string, { platformName: string; plans: Map<string, { planName: string; myCost: number | null; subs: any[] }> }>();
    
    for (const sub of filtered) {
      const pId = sub.plan.platform.id;
      const pName = sub.plan.platform.name;
      const planId = sub.planId;
      const planName = sub.plan.name;
      const myCost = sub.plan.cost;

      if (!grouped.has(pId)) {
        grouped.set(pId, { platformName: pName, plans: new Map() });
      }
      
      const platformMap = grouped.get(pId)!.plans;
      if (!platformMap.has(planId)) {
        platformMap.set(planId, { planName, myCost, subs: [] });
      }
      
      platformMap.get(planId)!.subs.push(sub);
    }

    return Array.from(grouped.values())
      .map(p => {
        const plans = Array.from(p.plans.values());
        let totalClients = 0;
        let totalRevenue = 0;

        for (const plan of plans) {
          for (const s of plan.subs) {
            const occupied = s.clientSubscriptions?.length || 0;
            totalClients += occupied;
            // Best effort revenue calc based on current subs and plan cost
            totalRevenue += occupied * s.plan.cost;
          }
        }

        return {
          platformName: p.platformName,
          plans,
          totalClients,
          totalRevenue
        };
      })
      .sort((a, b) => {
        if (b.totalClients !== a.totalClients) {
          return b.totalClients - a.totalClients; // Descending by clients
        }
        return b.totalRevenue - a.totalRevenue; // Tie-breaker: Descending by revenue
      });
  }, [subscriptions, search]);

  const selectedSub = subscriptions?.find((s) => s.id === selectedSubId);

  // Date preview
  const months = Number(durationMonths) || 0;
  const previewDate = months > 0 && startDate
    ? format(addMonths(new Date(startDate), months), "dd/MM/yyyy")
    : null;

  const resetForm = () => {
    setSearch("");
    setSelectedSubId("");
    setCustomPrice("");
    setDurationMonths("1");
    setStartDate(format(new Date(), "yyyy-MM-dd"));
    setServiceUser(previousServiceUser || "");
    setServicePassword(previousServicePassword || "");
    setShowPassword(false);
    setIsPaid(false);
    setPaymentNote("");
    setExpandedPlatforms({});
    setExpandedPlans({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubId || !customPrice || months < 1) return;

    await createSeat.mutateAsync({
      clientId,
      subscriptionId: selectedSubId,
      customPrice: parseFloat(customPrice),
      durationMonths: months,
      startDate: startDate,
      serviceUser: serviceUser || null,
      servicePassword: servicePassword || null,
      isPaid,
      paymentNote: paymentNote || null,
    });
    resetForm();
    onOpenChange(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) resetForm();
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh]">
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden min-h-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Plus className="size-5" />
              {t("assignSubscription")}
            </DialogTitle>
            <DialogDescription>
              {t.rich("assignSubscriptionDescription", {
                name: clientName,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 p-6 pt-2 space-y-4">
            {/* Subscription Search */}
            <div className="space-y-2">
              <Label>{t("subscriptions")}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchPlanOrPlatform")}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedSubId("");
                  }}
                  className="pl-9"
                />
              </div>

              {/* Subscription list */}
              {!selectedSubId && (
                <div className="max-h-56 overflow-y-auto rounded-md border text-sm">
                  {groupedSubs.length === 0 ? (
                    <p className="px-3 py-2 text-muted-foreground">
                      {search ? t("noSubscriptionsFound") : t("typeToSearch")}
                    </p>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {groupedSubs.map((platformGroup, pIdx) => {
                        const isPlatformExpanded = search.trim().length > 0 || expandedPlatforms[platformGroup.platformName];

                        return (
                          <div key={pIdx} className="p-1 space-y-1">
                            <button
                              type="button"
                              className="flex items-center justify-between w-full font-semibold text-xs text-muted-foreground uppercase tracking-wider px-2 py-2 hover:bg-accent/50 hover:text-foreground rounded-md transition-colors"
                              onClick={() => togglePlatform(platformGroup.platformName)}
                            >
                              <span>{platformGroup.platformName}</span>
                              {isPlatformExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                            
                            {isPlatformExpanded && (
                              <div className="space-y-2 pl-3 border-l-2 border-border/40 ml-2 mt-1 mb-2">
                                {platformGroup.plans.map((planGroup, plIdx) => {
                                  const planKey = `${platformGroup.platformName}-${planGroup.planName}`;
                                  const isPlanExpanded = search.trim().length > 0 || expandedPlans[planKey];

                                  return (
                                    <div key={plIdx} className="space-y-1">
                                      <button
                                        type="button"
                                        className="flex items-center justify-between w-full text-xs font-medium px-2 py-2 mb-1 text-primary/80 hover:bg-accent/70 hover:text-foreground active:scale-[0.99] rounded-md transition-all duration-200"
                                        onClick={() => togglePlan(planKey)}
                                      >
                                        <span>
                                          {planGroup.planName}
                                          {planGroup.myCost != null && <span className="text-muted-foreground font-normal ml-1">({CURRENCIES[((session?.user as { currency?: string })?.currency as Currency) || "EUR"].symbol}{planGroup.myCost})</span>}
                                        </span>
                                        {isPlanExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                                      </button>

                                      {isPlanExpanded && (
                                        <div className="space-y-1.5 pl-3 border-l-2 border-border/40 ml-2 py-1">
                                          {planGroup.subs.map((s) => {
                                            const occupied = s.clientSubscriptions?.length || 0;
                                            const max = s.plan.maxSeats;
                                            const isFull = max !== null && occupied >= max;
                                            return (
                                              <button
                                                key={s.id}
                                                type="button"
                                                disabled={isFull}
                                                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-all duration-200 ${isFull ? 'opacity-50 cursor-not-allowed bg-muted/30 grayscale-[50%]' : 'hover:bg-accent hover:text-accent-foreground border border-transparent hover:border-border/50 hover:shadow-sm active:scale-[0.98]'}`}
                                                onClick={() => {
                                                  setSelectedSubId(s.id);
                                                  setSearch(`${s.label} (${s.plan.platform.name})`);
                                                  if (!customPrice) setCustomPrice(s.plan.cost.toString());
                                                }}
                                              >
                                                <div className="truncate pr-3">
                                                  <p className="font-medium text-sm truncate">{s.label}</p>
                                                </div>
                                                <div className="text-xs text-right whitespace-nowrap flex-shrink-0">
                                                  <span className={isFull ? "text-destructive font-medium bg-destructive/10 px-1.5 py-0.5 rounded-sm" : "text-muted-foreground"}>
                                                    {occupied} / {max ?? "∞"}
                                                  </span>
                                                </div>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Selected sub badge */}
              {selectedSub && (
                <div className="flex items-center gap-2 rounded-md bg-accent/50 px-3 py-1.5 text-sm">
                  <span className="font-medium">{selectedSub.label}</span>
                  <span className="text-xs text-muted-foreground">({selectedSub.plan.platform.name})</span>
                  <button
                    type="button"
                    className="ml-auto h-6 px-2 text-xs hover:bg-accent/80 rounded-sm transition-colors"
                    onClick={() => {
                      setSelectedSubId("");
                      setSearch("");
                    }}
                  >
                    {t("change")}
                  </button>
                </div>
              )}
            </div>

            {/* Price + Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="sub-price">
                  {t("pricePerMonth", { symbol: CURRENCIES[((session?.user as { currency?: string })?.currency as Currency) || "EUR"].symbol })}
                </Label>
                <Input
                  id="sub-price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-duration">{t("durationMonths")}</Label>
                <Input
                  id="sub-duration"
                  type="number"
                  min="1"
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sub-start-date">{t("startDate")}</Label>
              <Input
                id="sub-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>

            {previewDate && (
               <p className="text-xs text-muted-foreground">
                 {isPaid 
                   ? t("activeUntil", { date: previewDate })
                   : t("paymentDueImmediately")}
               </p>
            )}

            {/* Payment Status */}
            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Already paid?</Label>
                <p className="text-[12px] text-muted-foreground">
                  If marked, a payment record will be created.
                </p>
              </div>
              <Switch
                checked={isPaid}
                onCheckedChange={setIsPaid}
              />
            </div>

            {isPaid && (
              <div className="space-y-2">
                <Label htmlFor="payment-note">Payment Note (Optional)</Label>
                <Input
                  id="payment-note"
                  placeholder={selectedSub?.defaultPaymentNote || "como pago"}
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                />
              </div>
            )}

            {/* Service Credentials */}
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                {t("serviceCredentials")} ({tc("optional")})
              </legend>
              <div className="space-y-2">
                <Label htmlFor="sub-user">{t("usernameEmail")}</Label>
                <Input
                  id="sub-user"
                  placeholder="e.g. john@example.com"
                  value={serviceUser}
                  onChange={(e) => setServiceUser(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-pass">Password</Label>
                <div className="relative">
                  <Input
                    id="sub-pass"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={servicePassword}
                    onChange={(e) => setServicePassword(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 size-7"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
            </fieldset>
          </div>

          <DialogFooter className="p-6 pt-2 border-t">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={createSeat.isPending || !selectedSubId || !customPrice}
            >
              {createSeat.isPending ? t("assigning") : t("assignSubscription")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
