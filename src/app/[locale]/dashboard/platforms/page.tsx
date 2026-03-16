"use client";

import { useState } from "react";
import { usePlatforms } from "@/hooks/use-platforms";
import { PlatformsTable } from "@/components/platforms/platforms-table";
import { PlatformFormDialog } from "@/components/platforms/platform-form-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSaasStatus } from "@/hooks/use-saas-status";
import { SAAS_LIMITS } from "@/lib/saas-constants";
import { Badge } from "@/components/ui/badge";
import { PremiumPopup } from "@/components/saas/premium-popup";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PlatformsPage() {
  const { data: platforms, isLoading } = usePlatforms();
  const { data: saas } = useSaasStatus();
  const [createOpen, setCreateOpen] = useState(false);
  const t = useTranslations("platforms");
  const ts = useTranslations("saas");

  const platformsLimitReached =
    saas?.plan === "FREE" && saas.usage.platforms >= SAAS_LIMITS.FREE.PLATFORMS;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
              {t("title")}
            </h1>
            {saas && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn(
                  "h-6 gap-1 px-2 font-bold border-dashed",
                  saas.plan === "PREMIUM" ? "border-gold-gradient/30 bg-gold-gradient/5 text-gold-gradient" : "text-muted-foreground"
                )}>
                  <span className={saas.plan === "FREE" && saas.usage.platforms >= SAAS_LIMITS.FREE.PLATFORMS ? "text-red-500" : ""}>
                    {saas.usage.platforms}
                  </span>
                  <span className="opacity-40">/</span>
                  <span>{saas.plan === "PREMIUM" ? "∞" : SAAS_LIMITS.FREE.PLATFORMS}</span>
                </Badge>
                {saas.plan === "FREE" && (
                  <PremiumPopup>
                    <Button variant="link" size="sm" className="h-6 px-0 text-xs text-primary gap-1">
                      <Sparkles className="size-3" />
                      {ts("upgrade")}
                    </Button>
                  </PremiumPopup>
                )}
              </div>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        {platformsLimitReached ? (
          <PremiumPopup>
            <Button>
              <Sparkles className="size-4" />
              {ts("upgradeToPremium")}
            </Button>
          </PremiumPopup>
        ) : (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("addPlatform")}
          </Button>
        )}
      </div>

      {/* Table */}
      <PlatformsTable platforms={platforms ?? []} isLoading={isLoading} />

      {/* Create dialog */}
      <PlatformFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
