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
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, CheckCircle2, Loader2, Zap, BarChart3, Bot, Globe } from "lucide-react";

export function PremiumPopup({ children }: { children?: React.ReactNode }) {
  const t = useTranslations("saas");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Failed to get checkout URL");
      }
    } catch (_error) {
      toast.error(t("upgradeError"));
      setLoading(false);
    }
  };

  const features = [
    { icon: Globe, key: "unlimitedPlatforms" },
    { icon: Bot, key: "aiAssistant" },
    { icon: BarChart3, key: "advancedAnalytics" },
    { icon: Zap, key: "prioritySupport" },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm" className="gap-2 border-primary/50 text-primary hover:bg-primary/5">
            <Sparkles className="h-4 w-4" />
            {t("upgrade")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-2xl">{t("popupTitle")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("popupDescription")}
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {features.map((f) => (
            <div key={f.key} className="flex items-center gap-3">
              <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-primary/5 flex items-center justify-center">
                <f.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-grow">
                <p className="text-sm font-medium leading-none">{t(`features.${f.key}.title`)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t(`features.${f.key}.description`)}
                </p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button 
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg py-6"
            onClick={handleUpgrade}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-5 w-5 mr-2" />
            )}
            {t("upgradeNow")}
          </Button>
          <p className="text-[10px] text-center text-muted-foreground">
            {t("cancelAnytime")}
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
