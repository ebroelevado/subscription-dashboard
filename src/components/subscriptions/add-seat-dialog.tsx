"use client";

import { useState, useMemo } from "react";
import { useClients } from "@/hooks/use-clients";
import { useCreateSeat } from "@/hooks/use-seats";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Search, UserPlus, Eye, EyeOff } from "lucide-react";
import { addMonths, format } from "date-fns";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES } from "@/lib/currency";

interface AddSeatDialogProps {
  subscriptionId: string;
  defaultPaymentNote?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSeatDialog({ subscriptionId, defaultPaymentNote, open, onOpenChange }: AddSeatDialogProps) {
  const createSeat = useCreateSeat();
  const { data: clients } = useClients();
  const { data: session } = useSession();

  const currency = (session?.user as { currency?: string })?.currency || "EUR";
  const symbol = (CURRENCIES[currency as keyof typeof CURRENCIES] || CURRENCIES.EUR).symbol;

  // Form state
  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [durationMonths, setDurationMonths] = useState("1");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [serviceUser, setServiceUser] = useState("");
  const [servicePassword, setServicePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [paymentNote, setPaymentNote] = useState("");

  // Search filter
  const filteredClients = useMemo(() => {
    if (!clients) return [];
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q))
    );
  }, [clients, search]);

  const selectedClient = clients?.find((c) => c.id === selectedClientId);

  // Date preview
  const months = Number(durationMonths) || 0;
  const previewDate = months > 0 && startDate
    ? format(addMonths(new Date(startDate), months), "dd/MM/yyyy")
    : null;

  const resetForm = () => {
    setSearch("");
    setSelectedClientId("");
    setCustomPrice("");
    setDurationMonths("1");
    setStartDate(format(new Date(), "yyyy-MM-dd"));
    setServiceUser("");
    setServicePassword("");
    setShowPassword(false);
    setIsPaid(false);
    setPaymentNote("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !customPrice || months < 1) return;

    await createSeat.mutateAsync({
      clientId: selectedClientId,
      subscriptionId,
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
      <DialogContent className="w-[95vw] sm:max-w-md p-0 overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh]">
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden min-h-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <UserPlus className="size-5" />
              Assign Client
            </DialogTitle>
            <DialogDescription>
              Search for a client and assign them to an available seat.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 p-6 pt-2 space-y-4">
            {/* Client Search */}
            <div className="space-y-2">
              <Label>Client</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or phone…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedClientId("");
                  }}
                  className="pl-9"
                />
              </div>

              {/* Client list */}
              {!selectedClientId && (
                <div className="max-h-44 overflow-y-auto rounded-md border text-sm">
                  {filteredClients.length === 0 ? (
                    <p className="px-3 py-2 text-muted-foreground">
                      {search ? "No clients found" : "Type to search…"}
                    </p>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {filteredClients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-[0.99]"
                          onClick={() => {
                            setSelectedClientId(c.id);
                            setSearch(c.name);
                          }}
                        >
                          <span className="font-medium text-sm">{c.name}</span>
                          {c.phone && (
                            <span className="text-xs text-muted-foreground">{c.phone}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Selected client badge */}
              {selectedClient && (
                <div className="flex items-center gap-2 rounded-md bg-accent/50 px-3 py-1.5 text-sm">
                  <span className="font-medium">{selectedClient.name}</span>
                  {selectedClient.phone && (
                    <span className="text-xs text-muted-foreground">({selectedClient.phone})</span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-xs"
                    onClick={() => {
                      setSelectedClientId("");
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
                <Label htmlFor="seat-price">Price ({symbol}/month)</Label>
                <Input
                  id="seat-price"
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
                <Label htmlFor="seat-duration">Duration (months)</Label>
                <Input
                  id="seat-duration"
                  type="number"
                  min="1"
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="seat-start-date">Start Date</Label>
              <Input
                id="seat-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>

            {previewDate && (
              <p className="text-xs text-muted-foreground">
                {isPaid
                  ? <>Active until: <span className="font-medium text-foreground">{previewDate}</span></>
                  : "Payment due immediately — seat will be inactive until paid."}
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
              <Switch checked={isPaid} onCheckedChange={setIsPaid} />
            </div>

            {isPaid && (
              <div className="space-y-2">
                <Label htmlFor="seat-payment-note">Payment Note (Optional)</Label>
                <Input
                  id="seat-payment-note"
                  placeholder={defaultPaymentNote || "como pago"}
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                />
              </div>
            )}

            {/* Service Credentials */}
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Service Credentials (optional)
              </legend>
              <div className="space-y-2">
                <Label htmlFor="seat-user">Username / Email</Label>
                <Input
                  id="seat-user"
                  placeholder="e.g. john@example.com"
                  value={serviceUser}
                  onChange={(e) => setServiceUser(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seat-pass">Password</Label>
                <div className="relative">
                  <Input
                    id="seat-pass"
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
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createSeat.isPending || !selectedClientId || !customPrice}
            >
              {createSeat.isPending ? "Assigning…" : "Assign Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
