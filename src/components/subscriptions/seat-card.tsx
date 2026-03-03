"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { UserCircle, Pause, Play, X, RefreshCw, Copy, Eye, EyeOff, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { differenceInDays, startOfDay } from "date-fns";
import { useTranslations } from "next-intl";

import { formatCurrency } from "@/lib/currency";
import { useSession } from "next-auth/react";

type ExpiryStatus = "ok" | "expiring" | "expired";

function getExpiryStatus(activeUntil: string, t: (key: string, values?: Record<string, string | number>) => string): {
  status: ExpiryStatus;
  label: string;
  daysText: string;
} {
  const today = startOfDay(new Date());
  const expiry = startOfDay(new Date(activeUntil));
  const diff = differenceInDays(expiry, today);

  if (diff < 0) {
    return {
      status: "expired",
      label: t("expired"),
      daysText: t("daysOverdue", { count: Math.abs(diff) }),
    };
  }
  if (diff === 0) {
    return { status: "expiring", label: t("today"), daysText: t("today") };
  }
  if (diff <= 3) {
    return {
      status: "expiring",
      label: t("daysLeft", { count: diff }),
      daysText: t("daysLeft", { count: diff }),
    };
  }
  return {
    status: "ok",
    label: t("daysLeft", { count: diff }),
    daysText: t("daysLeft", { count: diff }),
  };
}

const expiryColors: Record<ExpiryStatus, string> = {
  ok: "border-l-green-500",
  expiring: "border-l-yellow-500",
  expired: "border-l-red-500",
};

const expiryBadgeVariant: Record<ExpiryStatus, string> = {
  ok: "bg-muted/50 text-muted-foreground",
  expiring: "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20",
  expired: "bg-red-500/10 text-red-500 hover:bg-red-500/20",
};

const statusBadgeConfig: Record<
  "active" | "paused",
  { labelKey: string; variant: "default" | "secondary" | "destructive" }
> = {
  active: { labelKey: "active", variant: "default" },
  paused: { labelKey: "paused", variant: "secondary" },
};

interface SeatCardProps {
  seat: {
    id: string;
    clientId: string;
    customPrice: number;
    activeUntil: string;
    joinedAt: string;
    leftAt: string | null;
    status: "active" | "paused";
    client: {
      id: string;
      name: string;
      phone: string | null;
      serviceUser?: string | null;
      servicePassword?: string | null;
    };
  };
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRenew: () => void;
  onEdit: () => void;
}

export function SeatCard({ seat, onPause, onResume, onCancel, onRenew, onEdit }: SeatCardProps) {
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const { data: session } = useSession();
  const currency = (session?.user as { currency?: string })?.currency || "EUR";
  const [showPassword, setShowPassword] = useState(false);
  const expiry = getExpiryStatus(seat.activeUntil, tc);
  const hasCredentials = seat.client.serviceUser || seat.client.servicePassword;
  const isPaused = seat.status === "paused";
  const isActive = seat.status === "active";
  


  const statusConfig = statusBadgeConfig[seat.status as "active" | "paused"];

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(tc("copied", { label }));
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-l-4 p-4 transition-colors overflow-hidden min-w-0 ${
        isPaused
          ? "border-l-amber-500 bg-muted/40 opacity-80"
          : `hover:bg-muted/50 ${expiryColors[expiry.status]}`
      }`}
    >
      {/* Header: Client name + status badge + actions */}
      <div className="flex items-start justify-between gap-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
          <div className="flex items-center justify-center size-8 rounded-full bg-muted shrink-0">
            <UserCircle className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 overflow-hidden">
            <Link
              href={`/dashboard/clients/${seat.clientId}`}
              className="font-medium text-sm hover:underline truncate block"
            >
              {seat.client.name}
            </Link>
            {seat.client.phone && (
              <p className="text-xs text-muted-foreground truncate">{seat.client.phone}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Badge variant={statusConfig.variant} className="text-[10px] h-5">
            {tc(statusConfig.labelKey)}
          </Badge>
          
          {/* Edit */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={onEdit}
                >
                  <Pencil className="size-3.5" />
                  <span className="sr-only">{tc("edit")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("editSeat")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Pause / Resume toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`size-7 ${
                    isPaused
                      ? "text-green-600 hover:text-green-700 dark:text-green-400"
                      : "text-amber-600 hover:text-amber-700 dark:text-amber-400"
                  }`}
                  onClick={isPaused ? onResume : onPause}
                >
                  {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                  <span className="sr-only">{isPaused ? tc("resume") : tc("pause")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isPaused ? t("resumeAll") : t("pauseAll")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Renew — only for active seats */}
          {isActive && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                    onClick={onRenew}
                  >
                    <RefreshCw className="size-3.5" />
                    <span className="sr-only">{t("renewSeat")}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("renewPlatform")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Cancel (Hard Delete) */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={onCancel}
                >
                  <X className="size-3.5" />
                  <span className="sr-only">{tc("delete")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("removeSeat")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Price */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{tc("plan")}</span>
        <span className="font-mono font-medium">
          {formatCurrency(Number(seat.customPrice), currency)}
        </span>
      </div>

      {/* Expiry with color */}
      <div className="flex items-center justify-between gap-2 text-sm min-w-0">
        <span className="text-muted-foreground shrink-0">
          {isPaused ? t("frozenUntil") : t("expires")}
        </span>
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-xs text-muted-foreground truncate">
            {new Date(seat.activeUntil).toLocaleDateString("es-ES")}
          </span>
          <Badge variant={isPaused ? "secondary" : "outline"} className={`text-xs shrink-0 whitespace-nowrap border-0 ${isPaused ? "" : expiryBadgeVariant[expiry.status]}`}>
            {isPaused ? tc("paused") : expiry.daysText}
          </Badge>
        </div>
      </div>

      {/* Credentials */}
      {hasCredentials && (
        <div className="rounded border bg-muted/30 p-2 space-y-1.5 overflow-hidden">
          {seat.client.serviceUser && (
            <div className="flex items-center justify-between text-xs gap-2 overflow-hidden">
              <span className="text-muted-foreground shrink-0">{t("serviceUser")}</span>
              <div className="flex items-center gap-1 min-w-0">
                <code className="font-mono text-xs truncate">{seat.client.serviceUser}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0"
                  onClick={() =>
                    copyToClipboard(seat.client.serviceUser!, t("serviceUser"))
                  }
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
          )}
          {seat.client.servicePassword && (
            <div className="flex items-center justify-between text-xs gap-2 overflow-hidden">
              <span className="text-muted-foreground shrink-0">{t("servicePassword")}</span>
              <div className="flex items-center gap-1 min-w-0">
                <code className="font-mono text-xs truncate">
                  {showPassword
                    ? seat.client.servicePassword
                    : "••••••••"}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="size-3" />
                  ) : (
                    <Eye className="size-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  onClick={() =>
                    copyToClipboard(seat.client.servicePassword!, t("servicePassword"))
                  }
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
