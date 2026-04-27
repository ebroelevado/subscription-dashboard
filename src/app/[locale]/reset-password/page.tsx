"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Lock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error("Invalid or missing reset token");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await authClient.resetPassword({
        newPassword: password,
        token,
      });

      if (error) {
        toast.error(error.message || "Failed to reset password");
        return;
      }

      setIsSuccess(true);
      toast.success("Password reset successfully!");
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch (err) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center py-8">
          <CardHeader>
            <CardTitle className="text-destructive">Invalid Link</CardTitle>
            <CardDescription>
              The password reset link is invalid or has expired.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild>
              <Link href="/forgot-password">Request new link</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/30">
      
      {/* Top Navigation */}
      <div className="absolute top-0 left-0 w-full p-4 sm:p-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground hover:text-foreground">
          <Link href="/login">
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">{tc("goBack") || "Back"}</span>
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>

      <div className="w-full max-w-md space-y-8 z-10">
        <div className="flex flex-col items-center gap-3">
          <Logo size={48} className="text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Pearfect S.L.</h1>
        </div>

        <Card className="border-border/60 shadow-2xl shadow-black/5 bg-background/80 backdrop-blur-xl">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl font-semibold tracking-tight">
              {isSuccess ? t("success") : t("resetPasswordTitle") || "Reset Password"}
            </CardTitle>
            <CardDescription className="text-sm mt-2">
              {isSuccess 
                ? t("passwordResetSuccessDescription") || "Your password has been reset successfully. Redirecting to login..."
                : t("resetPasswordDescription") || "Enter your new password below."}
            </CardDescription>
          </CardHeader>

          {!isSuccess ? (
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2.5">
                  <Label htmlFor="password">{t("newPassword") || "New Password"}</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-muted/30 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="confirmPassword">{t("confirmPassword") || "Confirm New Password"}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-muted/30 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4 pt-2">
                <Button type="submit" className="w-full h-10" disabled={isLoading}>
                  {isLoading && <Loader2 className="size-4 animate-spin mr-2" />}
                  {t("resetPassword") || "Reset Password"}
                </Button>
              </CardFooter>
            </form>
          ) : (
            <CardContent className="flex flex-col items-center gap-4 py-6">
              <div className="size-16 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                <CheckCircle2 className="size-8" />
              </div>
              <Button variant="ghost" asChild className="mt-2 text-primary">
                <Link href="/login">{t("goToLogin") || "Back to login"}</Link>
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
