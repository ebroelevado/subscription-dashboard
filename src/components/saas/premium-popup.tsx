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
  // Free for all - just render children directly
  return <>{children}</>;
}
