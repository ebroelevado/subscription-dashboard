"use client";

import { useState, useRef, useEffect, useActionState } from "react";
import { useSession, authClient } from "@/lib/auth-client";
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
  CreditCard,
  Globe,
  Lock,
  Shield,
  Database,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  useClearAccountData,
  useDeleteAccount,
} from "@/hooks/use-account";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { useTranslations } from "next-intl";

import { SubscriptionManager } from "@/components/saas/subscription-manager";
import { usePathname, useSearchParams } from "next/navigation";
import { useSaasStatus } from "@/hooks/use-saas-status";

// ── Profile Section ──
function ProfileSection() {
  const { data: session } = useSession();
  const user = session?.user;
  const updateProfile = useUpdateProfile();
  const t = useTranslations("settings");

  const [name, setName] = useState(user?.name ?? "");
  const [image, setImage] = useState(user?.image ?? "");

  useEffect(() => {
    if (user) {
      if (!name && user.name) setName(user.name);
      if (!image && user.image) setImage(user.image);
    }
  }, [user]);

  const handleSave = () => {
    updateProfile.mutate(
      {
        name: name || undefined,
        image: image || null,
      },
      {
        onSuccess: async () => {
          toast.success(t("profileUpdated"));
          await authClient.updateUser({ name, image });
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

// ── Preferences Section ──
function PreferencesSection() {
  const t = useTranslations("settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-5" />
          {t("preferences", { fallback: "Preferences" })}
        </CardTitle>
        <CardDescription>
          {t("preferencesDescription", { fallback: "Customize the look, language, and currency of your dashboard." })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  );
}

// ── Security Section ──
function SecuritySection() {
  const { data: session } = useSession();
  const user = session?.user;
  const hasPassword = (user as any)?.hasPassword;
  const t = useTranslations("settings");

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
      
      if (!hasPassword) {
        window.location.reload();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="size-5" />
          {t("security", { fallback: "Security" })}
        </CardTitle>
        <CardDescription>
          {t("securityDescription", { fallback: "Manage your password and account security." })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">
              {hasPassword ? t("changePassword", { fallback: "Change Password" }) : t("setupPassword", { fallback: "Set up Password" })}
            </h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {hasPassword
              ? t("changePasswordDescription", { fallback: "Update your current password." })
              : t("setupPasswordDescription", { fallback: "Set a password to log in without Google." })}
          </p>

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
    </Card>
  );
}

// ── Data & Privacy Section ──
function DataSection() {
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
    e.target.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-5" />
          {t("data")}
        </CardTitle>
        <CardDescription>
          {t("exportDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Export */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Download className="size-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">{t("exportData")}</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("exportDescription")}
          </p>
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
          <div className="flex items-center gap-2">
            <Upload className="size-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">{t("importData")}</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("importDescription")}
          </p>
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

        {/* Danger Zone */}
        <div className="pt-6 border-t mt-6">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-4">
            <div className="flex items-center gap-2 text-destructive font-semibold">
              <AlertTriangle className="size-4" />
              {t("danger")}
            </div>

            <div>
              <h4 className="text-sm font-medium text-destructive">
                {t("clearData")}
              </h4>
              <p className="text-xs text-muted-foreground mt-1">
                {t("clearDataWarning")}
              </p>
            </div>

            <ClearDataButton />

            <div className="border-t border-destructive/20 pt-4">
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

function ClearDataButton() {
  const clearData = useClearAccountData();
  const [confirmText, setConfirmText] = useState("");
  const [open, setOpen] = useState(false);
  const t = useTranslations("settings");
  const tc = useTranslations("common");

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="bg-destructive/80 hover:bg-destructive">
          <Trash2 className="size-4 mr-2" />
          {t("clearData")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmClearData")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("clearDataDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t.rich("typeClearToConfirm", {
              confirmWord: t("clearConfirmPlaceholder"),
              word: (word) => (
                <span className="font-bold text-destructive underline decoration-2 underline-offset-2">
                  {word}
                </span>
              ),
            })}
          </p>
          <Input
            placeholder={t("clearConfirmPlaceholder")}
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
            disabled={confirmText !== t("clearConfirmPlaceholder") || clearData.isPending}
            onClick={(e) => {
              e.preventDefault();
              clearData.mutate(undefined, {
                onSuccess: () => {
                  toast.success(t("clearDataSuccess"));
                  setConfirmText("");
                  setOpen(false);
                },
                onError: (err) => {
                  toast.error(err.message);
                  setOpen(false);
                },
              });
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {clearData.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            {tc("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

// ── Page ──
export default function SettingsPage() {
  const t = useTranslations("settings");
  const { data: saasStatus } = useSaasStatus();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = pathname.split("/")[1] || "en";
  const requestedTab = searchParams.get("tab");
  const validTabs = new Set(["general", "preferences", "security", "data", "subscription"]);
  const defaultTab = requestedTab && validTabs.has(requestedTab) ? requestedTab : "general";
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const tabs = [
    { value: "general", label: t("general", { fallback: "General" }), icon: Settings },
    { value: "preferences", label: t("preferences", { fallback: "Preferences" }), icon: Palette },
    { value: "security", label: t("security", { fallback: "Security" }), icon: Shield },
    { value: "data", label: t("data"), icon: Database },
    { value: "subscription", label: t("subscription"), icon: CreditCard },
  ];

  return (
    <div className="space-y-6 pb-16">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="size-6" />
          {t("title")}
        </h2>
        <p className="text-muted-foreground">
          {t("description")}
        </p>
      </div>

      {/* Top Bar Navigation */}
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-1.5">
        {tabs.map((tab) => {
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "relative flex w-full items-center justify-center gap-2 rounded-lg px-2 sm:px-3 py-2.5 text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
                activeTab === tab.value
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border after:absolute after:top-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              <tab.icon className="size-4 shrink-0" />
              <span className="hidden sm:inline truncate">{tab.label}</span>
            </button>
          );
        })}
        </div>
        <div className="h-px bg-border/50" />
      </div>

      {/* Content */}
      <div className="w-full">
        {activeTab === "general" && <ProfileSection />}
        {activeTab === "preferences" && <PreferencesSection />}
        {activeTab === "security" && <SecuritySection />}
        {activeTab === "data" && <DataSection />}
        {activeTab === "subscription" && <SubscriptionManager locale={locale} />}
      </div>
    </div>
  );
}
