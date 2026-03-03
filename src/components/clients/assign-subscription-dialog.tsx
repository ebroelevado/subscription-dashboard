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
import { Search, Plus, Eye, EyeOff } from "lucide-react";
import { addMonths, format } from "date-fns";

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

  // Form state
  const [search, setSearch] = useState("");
  const [selectedSubId, setSelectedSubId] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [durationMonths, setDurationMonths] = useState("1");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [serviceUser, setServiceUser] = useState(previousServiceUser || "");
  const [servicePassword, setServicePassword] = useState(previousServicePassword || "");
  const [showPassword, setShowPassword] = useState(false);

  // Search filter
  const filteredSubs = useMemo(() => {
    if (!subscriptions) return [];
    if (!search.trim()) return subscriptions;
    const q = search.toLowerCase();
    return subscriptions.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.plan.platform.name.toLowerCase().includes(q)
    );
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5" />
            Assign Subscription
          </DialogTitle>
          <DialogDescription>
            Assign <strong>{clientName}</strong> to a subscription.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Subscription Search */}
          <div className="space-y-2">
            <Label>Subscription</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search plan or platform…"
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
              <div className="max-h-36 overflow-y-auto rounded-md border text-sm">
                {filteredSubs.length === 0 ? (
                  <p className="px-3 py-2 text-muted-foreground">
                    {search ? "No subscriptions found" : "Type to search…"}
                  </p>
                ) : (
                  filteredSubs.map((s) => {
                     const occupied = s.clientSubscriptions?.length || 0;
                     const max = s.plan.maxSeats;
                     const isFull = max !== null && occupied >= max;
                     return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isFull}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent transition-colors ${isFull ? 'opacity-50 cursor-not-allowed' : ''}`}
                        onClick={() => {
                          setSelectedSubId(s.id);
                          setSearch(`${s.label} (${s.plan.platform.name})`);
                          // Auto-fill price if empty
                          if (!customPrice) setCustomPrice(s.plan.cost.toString());
                        }}
                      >
                        <div>
                          <p className="font-medium">{s.label}</p>
                          <p className="text-xs text-muted-foreground">{s.plan.platform.name} · {s.plan.name}</p>
                        </div>
                        <div className="text-xs text-right">
                          <p>{occupied} / {max ?? "∞"}</p>
                          {isFull && <p className="text-destructive font-medium">FULL</p>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {/* Selected sub badge */}
            {selectedSub && (
              <div className="flex items-center gap-2 rounded-md bg-accent/50 px-3 py-1.5 text-sm">
                <span className="font-medium">{selectedSub.label}</span>
                <span className="text-xs text-muted-foreground">({selectedSub.plan.platform.name})</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={() => {
                    setSelectedSubId("");
                    setSearch("");
                  }}
                >
                  Change
                </Button>
              </div>
            )}
          </div>

          {/* Price + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sub-price">
                Price ({CURRENCIES[((session?.user as { currency?: string })?.currency as Currency) || "EUR"].symbol}/month)
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
              <Label htmlFor="sub-duration">Duration (months)</Label>
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
            <Label htmlFor="sub-start-date">Start Date</Label>
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
               Active until: <span className="font-medium text-foreground">{previewDate}</span>
             </p>
          )}

          {/* Service Credentials */}
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              Service Credentials (optional)
            </legend>
            <div className="space-y-2">
              <Label htmlFor="sub-user">Username / Email</Label>
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createSeat.isPending || !selectedSubId || !customPrice}
            >
              {createSeat.isPending ? "Assigning…" : "Assign Subscription"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
