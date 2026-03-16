"use client";

import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  User,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  Loader2,
  Settings,
  Palette,
  BrainCircuit,
  Github,
  LogOut,
  CreditCard,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PremiumPopup } from "@/components/saas/premium-popup";
import { Sparkles } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { CurrencySelector } from "@/components/currency-selector";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updatePasswordAction } from "@/actions/password";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  useUpdateProfile,
  useExportData,
  useImportData,
  useDeleteAccount,
  useUpdateSettings,
} from "@/hooks/use-account";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Slider } from "@/components/ui/slider";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { SubscriptionManager } from "@/components/saas/subscription-manager";
import { usePathname, useSearchParams } from "next/navigation";
import { useSaasStatus } from "@/hooks/use-saas-status";


// ── Profile Tab ──
function ProfileTab() {
  const { data: session, update: updateSession } = useSession();
  const user = session?.user;
  const updateProfile = useUpdateProfile();
  const t = useTranslations("settings");

  const [name, setName] = useState(user?.name ?? "");
  const [image, setImage] = useState(user?.image ?? "");
  const [companyName, setCompanyName] = useState((user as any)?.companyName ?? "");
  const [whatsappSignatureMode, setWhatsappSignatureMode] = useState<string>((user as any)?.whatsappSignatureMode ?? "name");
  const hasPassword = user?.hasPassword;

  // Sync state if session user changes (needed when first loading the page)
  useEffect(() => {
    if (user) {
      if (!name && user.name) setName(user.name);
      if (!image && user.image) setImage(user.image);
      if (!companyName && (user as any).companyName) setCompanyName((user as any).companyName);
      if ((user as any).whatsappSignatureMode) setWhatsappSignatureMode((user as any).whatsappSignatureMode);
    }
  }, [user]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const handlePasswordSubmit = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error(t("passwordTooShort", { fallback: "Password must be at least 6 characters" }));
      return;
    }

    if (hasPassword && !currentPassword) {
      toast.error(t("currentPasswordRequired", { fallback: "Current password is required" }));
      return;
    }
    
    setIsUpdatingPassword(true);
    try {
      const formData = new FormData();
      if (hasPassword) formData.append("currentPassword", currentPassword);
      formData.append("newPassword", newPassword);

      // Using dynamic import of Server Action to avoid module issues if needed,
      // but assuming it's imported at the top. Let's assume fetch/api or action.
      // Wait, we need to import updatePasswordAction, I will add it top of file.
      
      const result = await updatePasswordAction(null, formData);
      
      if (!result.success) {
        throw new Error(result.error || "Failed to update password");
      }
      
      toast.success(
        hasPassword
          ? t("passwordUpdated", { fallback: "Password updated successfully!" })
          : t("passwordSetSuccess", { fallback: "Password set! You can now log in with email." })
      );
      
      setCurrentPassword("");
      setNewPassword("");
      
      // Update session to reflect hasPassword
      if (!hasPassword) {
        updateSession({ user: { ...user, hasPassword: true } });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const updateSettings = useUpdateSettings();

  const handleSave = () => {
    updateProfile.mutate(
      {
        name: name || undefined,
        image: image || null,
      },
      {
        onSuccess: () => {
          // Only update settings if critical values actually changed
          if (
            companyName !== ((user as any)?.companyName ?? "") || 
            whatsappSignatureMode !== ((user as any)?.whatsappSignatureMode ?? "name")
          ) {
            updateSettings.mutate({ 
              companyName: companyName || null,
              whatsappSignatureMode,
            }, {
              onSuccess: () => {
                toast.success(t("profileUpdated"));
                updateSession({ name, image, companyName, whatsappSignatureMode });
              },
              onError: (err: any) => toast.error(err.message),
            });
          } else {
            toast.success(t("profileUpdated"));
            updateSession({ name, image });
          }
        },
        onError: (err: any) => toast.error(err.message),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="size-5" />
          {t("profile")}
        </CardTitle>
        <CardDescription>
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row items-center gap-6 pb-4 border-b">
          <Avatar className="size-24 border-2 border-muted">
            <AvatarImage src={image || ""} alt={name} />
            <AvatarFallback className="text-2xl">
              {name.slice(0, 2).toUpperCase() || <User className="size-10" />}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2 text-center sm:text-left">
            <h3 className="text-lg font-medium">{t("profileImage")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("profileImageDescription")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">{t("displayName")}</Label>
            <Input
              id="name"
              placeholder={t("displayName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="image">{t("profileImage")}</Label>
            <Input
              id="image"
              placeholder="https://example.com/avatar.jpg"
              value={image || ""}
              onChange={(e) => setImage(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="companyName">{t("companyName", { fallback: "Company Name" })}</Label>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full">
            <div className="flex-1 space-y-1 w-full">
              <Input
                id="companyName"
                placeholder={t("companyNamePlaceholder", { fallback: "e.g. Acme Corp" })}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                maxLength={100}
              />
              <p className="text-[0.8rem] text-muted-foreground pt-1">
                {t("companyNameDescription", { fallback: "Used in automated WhatsApp messages." })}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6 pt-6 border-t">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-base font-medium">{t("signatureMode", { fallback: "WhatsApp Signature Mode" })}</Label>
              {!companyName && (
                <span className="text-[0.65rem] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                  {t("companyMissing", { fallback: "Setup Company for more options" })}
                </span>
              )}
            </div>
            
            <div className="px-2 py-4">
              <Slider
                min={0}
                max={companyName ? 2 : 1}
                step={1}
                value={[
                  whatsappSignatureMode === "none" ? 0 : 
                  whatsappSignatureMode === "name" ? 1 : 
                  2
                ]}
                onValueChange={(val) => {
                  const mode = val[0] === 0 ? "none" : val[0] === 1 ? "name" : "company";
                  setWhatsappSignatureMode(mode);
                }}
                className="w-full"
              />
              <div className="flex justify-between w-full px-1 pt-2 text-[0.65rem] text-muted-foreground uppercase font-bold tracking-tighter">
                <span>{t("signatureNone")}</span>
                <span>{t("signatureName")}</span>
                {companyName && <span>{t("signatureCompany")}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            value={user?.email ?? ""}
            disabled
            className="bg-muted/50 cursor-not-allowed"
          />
          <p className="text-[0.8rem] text-muted-foreground">
            {t("emailDescription")}
          </p>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <div>
            <h3 className="text-lg font-medium">
              {hasPassword ? t("changePassword", { fallback: "Change Password" }) : t("setupPassword", { fallback: "Set up Password" })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {hasPassword
                ? t("changePasswordDescription", { fallback: "Update your current password." })
                : t("setupPasswordDescription", { fallback: "Set a password to log in without Google." })}
            </p>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2">
            {hasPassword && (
              <div className="space-y-2">
                <Label htmlFor="currentPassword">{t("currentPassword", { fallback: "Current Password" })}</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t("newPassword", { fallback: "New Password" })}</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handlePasswordSubmit}
            disabled={isUpdatingPassword || !newPassword || (hasPassword && !currentPassword)}
          >
            {isUpdatingPassword ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {hasPassword ? t("updatePassword", { fallback: "Update Password" }) : t("setPassword", { fallback: "Set Password" })}
          </Button>
        </div>
      </CardContent>
      <CardFooter className="bg-muted/50 px-6 py-4 border-t flex justify-end">
        <Button onClick={handleSave} disabled={updateProfile.isPending}>
          {updateProfile.isPending && (
            <Loader2 className="mr-2 size-4 animate-spin" />
          )}
          {t("saveChanges")}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Appearance Tab ──
function AppearanceTab() {
  const t = useTranslations("settings");
  const { data: session, update: updateSession } = useSession();
  const updateSettings = useUpdateSettings();
  
  const initialPenalty = (session?.user as { disciplinePenalty?: number })?.disciplinePenalty ?? 0.5;
  const [penalty, setPenalty] = useState(initialPenalty);

  // Sync state if session changes initially
  useEffect(() => {
    const sessionPenalty = (session?.user as { disciplinePenalty?: number })?.disciplinePenalty;
    // Only sync if penalty is at default and session has a different value
    if (sessionPenalty !== undefined && penalty !== sessionPenalty) {
      setPenalty(sessionPenalty);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

  // Handle explicitly saving the appearance settings
  const handleSave = () => {
    if (penalty !== initialPenalty) {
      updateSettings.mutate(
        { disciplinePenalty: penalty },
        {
          onSuccess: () => {
            updateSession({ disciplinePenalty: penalty });
            toast.success(t("penaltyUpdated", { fallback: "Penalty updated successfully" }));
          },
          onError: (err: any) => toast.error(err.message),
        }
      );
    } else {
      toast.success(t("noChanges", { fallback: "No changes to save" }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-5" />
          {t("appearance")}
        </CardTitle>
        <CardDescription>
          {t("appearanceDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <h4 className="text-sm font-medium">{t("appearance")}</h4>
            <p className="text-xs text-muted-foreground">
              {t("appearanceDescription")}
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <h4 className="text-sm font-medium">{t("language")}</h4>
            <p className="text-xs text-muted-foreground">
              {t("language")}
            </p>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <h4 className="text-sm font-medium">{t("currency")}</h4>
            <p className="text-xs text-muted-foreground">
              {t("currencyDescription")}
            </p>
          </div>
          <CurrencySelector />
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h4 className="text-sm font-medium">{t("disciplineStrictness", { fallback: "Discipline Strictness" })}</h4>
              <p className="text-xs text-muted-foreground">
                {t("disciplineStrictnessDesc", { fallback: "Adjust the daily penalty for late payments (-0.5 by default)." })}
              </p>
            </div>
            <div className="font-mono font-bold text-sm bg-muted px-2 py-1 rounded">
              -{penalty.toFixed(1)} / {t("day", { fallback: "day" })}
            </div>
          </div>
          <Slider
            value={[penalty]}
            onValueChange={(vals: number[]) => setPenalty(vals[0])}
            max={5}
            min={0}
            step={0.1}
            disabled={updateSettings.isPending}
          />
        </div>
      </CardContent>
      <CardFooter className="bg-muted/50 px-6 py-4 border-t flex justify-end">
        <Button onClick={handleSave} disabled={updateSettings.isPending || penalty === initialPenalty}>
          {updateSettings.isPending && (
            <Loader2 className="mr-2 size-4 animate-spin" />
          )}
          {t("saveChanges")}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Data Tab ──
function DataTab() {
  const exportData = useExportData();
  const importData = useImportData();
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("settings");

  const handleExport = () => {
    toast.promise(exportData.mutateAsync(), {
      loading: t("exporting"),
      success: t("exportSuccess"),
      error: (err) => err.message,
    });
  };

  const handleImport = () => {
    fileRef.current?.click();
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        toast.promise(importData.mutateAsync(json), {
          loading: t("importing"),
          success: t("importSuccess"),
          error: (err) => err.message,
        });
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);

    // Reset file input so the same file can be picked again
    e.target.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="size-5" />
          {t("data")}
        </CardTitle>
        <CardDescription>
          {t("exportDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Export */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div>
            <h4 className="text-sm font-medium">{t("exportData")}</h4>
            <p className="text-xs text-muted-foreground mt-1">
              {t("exportDescription")}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportData.isPending}
          >
            {exportData.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {t("exportData")}
          </Button>
        </div>

        {/* Import */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div>
            <h4 className="text-sm font-medium">{t("importData")}</h4>
            <p className="text-xs text-muted-foreground mt-1">
              {t("importDescription")}
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={onFileSelected}
          />
          <Button
            variant="outline"
            onClick={handleImport}
            disabled={importData.isPending}
          >
            {importData.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {t("importData")}
          </Button>
        </div>

        {/* Danger Zone moved here */}
        <div className="pt-6 border-t mt-6">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-4">
            <div className="flex items-center gap-2 text-destructive font-semibold">
              <AlertTriangle className="size-4" />
              {t("danger")}
            </div>
            <div>
              <h4 className="text-sm font-medium text-destructive">
                {t("deleteAccount")}
              </h4>
              <p className="text-xs text-muted-foreground mt-1">
                {t("deleteWarning")}
              </p>
            </div>

            <DeleteAccountButton />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteAccountButton() {
  const deleteAccount = useDeleteAccount();
  const [confirmText, setConfirmText] = useState("");
  const [open, setOpen] = useState(false);
  const t = useTranslations("settings");
  const tc = useTranslations("common");

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 className="size-4 mr-2" />
          {t("deleteAccount")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmDelete")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t.rich("typeDeleteToConfirm", {
              confirmWord: t("deleteConfirmPlaceholder"),
              word: (word) => (
                <span className="font-bold text-destructive underline decoration-2 underline-offset-2">
                  {word}
                </span>
              ),
            })}
          </p>
          <Input
            placeholder={t("deleteConfirmPlaceholder")}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
            className="font-mono"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setConfirmText("")}>
            {tc("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={confirmText !== t("deleteConfirmPlaceholder") || deleteAccount.isPending}
            onClick={(e) => {
              e.preventDefault();
              deleteAccount.mutate(undefined, {
                onError: (err) => {
                  toast.error(err.message);
                  setOpen(false);
                },
              });
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleteAccount.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            {tc("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}


// ── Assistant Tab ──
function AssistantTab() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [open, setOpen] = useState(false);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/copilot/logout", { method: "POST" });
      if (res.ok) {
        toast.success(t("disconnectSuccess"));
        setOpen(false);
        // We could use router.refresh() or window.location.reload()
        // but since it's a settings change, a simple success toast might be enough.
        // However, the chat interface needs to know. A reload is safest for the token state.
        window.location.reload();
      } else {
        throw new Error("Failed to disconnect");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error disconnecting");
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="size-5" />
          {t("assistant")}
        </CardTitle>
        <CardDescription>
          {t("assistantDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-transparent to-primary/5 p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="size-12 rounded-xl bg-zinc-950 dark:bg-zinc-900 flex items-center justify-center border border-zinc-800 shrink-0 shadow-lg">
                <Github className="size-6 text-white" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-semibold tracking-tight">{t("copilotTitle")}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
                  {t("copilotDescription")}
                </p>
              </div>
            </div>
            
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="shrink-0 font-medium group hover:border-destructive hover:text-destructive transition-all">
                  <LogOut className="size-4 mr-2 group-hover:scale-110 transition-transform" />
                  {t("disconnectCopilot")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-xl">{t("confirmDisconnect")}</AlertDialogTitle>
                  <AlertDialogDescription className="text-base">
                    {t("disconnectDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-6">
                  <AlertDialogCancel className="font-medium">{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={(e) => {
                      e.preventDefault();
                      handleDisconnect();
                    }}
                    disabled={isDisconnecting}
                    className="bg-destructive text-white hover:bg-destructive/90 font-medium"
                  >
                    {isDisconnecting && <Loader2 className="size-4 animate-spin mr-2" />}
                    {t("disconnectCopilot")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg w-fit">
            <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected to GitHub Copilot
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──
export default function SettingsPage() {
  const t = useTranslations("settings");
  const { data: saasStatus } = useSaasStatus();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = pathname.split("/")[1] || "en";
  const isPremiumUser = saasStatus?.plan === "PREMIUM";
  const requestedTab = searchParams.get("tab");
  const validTabs = new Set(["profile", "appearance", "assistant", "data", "subscription"]);
  const defaultTab = requestedTab && validTabs.has(requestedTab) ? requestedTab : "profile";
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="size-6" />
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="flex justify-center sm:justify-start">
          <TabsList className="inline-flex h-12 items-center justify-center rounded-xl bg-muted/50 p-1 text-muted-foreground shadow-sm border border-border/40 w-full sm:w-auto">
            {[
              { value: "profile", label: t("profile"), icon: User },
              { value: "appearance", label: t("appearance"), icon: Palette },
              { value: "assistant", label: t("assistant"), icon: BrainCircuit, premium: true },
              { value: "data", label: t("data"), icon: Download },
              { value: "subscription", label: t("subscription"), icon: CreditCard },
            ].map((tab) => {
              const isLocked = tab.premium && !isPremiumUser;

              const trigger = (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  disabled={isLocked}
                  className={cn(
                    "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 h-full gap-2",
                    "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50",
                    "hover:text-foreground/80 hover:bg-muted/30 transition-colors"
                  )}
                >
                  <tab.icon className="size-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {isLocked && <Sparkles className="size-3 text-gold-gradient animate-sparkle" />}
                </TabsTrigger>
              );

              if (isLocked) {
                return (
                  <PremiumPopup key={tab.value}>
                    <button className="flex-1 sm:flex-none h-full focus:outline-none">
                      {trigger}
                    </button>
                  </PremiumPopup>
                );
              }

              return trigger;
            })}
          </TabsList>
        </div>

        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>

        <TabsContent value="assistant">
          <AssistantTab />
        </TabsContent>

        <TabsContent value="data">
          <DataTab />
        </TabsContent>

        <TabsContent value="subscription">
          <SubscriptionManager locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
