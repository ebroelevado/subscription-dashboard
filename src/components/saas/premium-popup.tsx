"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";

export function PremiumPopup({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/stripe/checkout", { method: "POST" });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to start checkout");
      }

      if (payload?.url) {
        window.location.href = payload.url;
        return;
      }

      toast.success("Your plan is already active.");
      setOpen(false);
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start checkout";
      toast.error(message);
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button size="sm" className="gap-2">
            <Sparkles className="h-4 w-4" />
            Upgrade to Premium
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Unlock Premium
          </DialogTitle>
          <DialogDescription>
            Keep your current workflow. Premium only removes limits and unlocks advanced insights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Advanced analytics and AI assistance
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Higher operational limits and smoother scaling
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Billing managed securely in Stripe
          </div>
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Not now
          </Button>
          <Button onClick={handleCheckout} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Continue to Checkout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
