"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Mail } from "lucide-react";
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

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    const { locale } = (window as any).__NEXT_INTL_LOCALE__ ? { locale: (window as any).__NEXT_INTL_LOCALE__ } : { locale: "es" };
    
    setIsLoading(true);
    try {
      console.log("[AUTH_CLIENT] Sending forget password request for:", email);
      const { data, error } = await authClient.forgetPassword({
        email,
        redirectTo: `${window.location.origin}/${locale}/reset-password`,
      });

      if (error) {
        console.error("[AUTH_CLIENT] Forget password error:", error);
        toast.error(error.message || "Failed to send reset link");
        return;
      }

      console.log("[AUTH_CLIENT] Forget password request successful");
      setIsSent(true);
      toast.success("Reset link sent to your email!");
    } catch (err) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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
              {isSent ? t("checkEmail") || "Check your email" : t("forgotPasswordTitle") || "Forgot password?"}
            </CardTitle>
            <CardDescription className="text-sm mt-2">
              {isSent 
                ? t("resetLinkSent") || "We've sent a password reset link to your email." 
                : t("forgotPasswordDescription") || "Enter your email address and we'll send you a link to reset your password."}
            </CardDescription>
          </CardHeader>

          {!isSent ? (
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2.5">
                  <Label htmlFor="email" className="text-sm font-medium">{t("emailLabel")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-muted/30 focus-visible:bg-transparent transition-colors"
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4 pt-2">
                <Button type="submit" className="w-full h-10" disabled={isLoading || !email}>
                  {isLoading && <Loader2 className="size-4 animate-spin mr-2" />}
                  {t("sendResetLink") || "Send Reset Link"}
                </Button>
              </CardFooter>
            </form>
          ) : (
            <CardContent className="flex flex-col items-center gap-4 py-6">
              <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Mail className="size-8" />
              </div>
              <p className="text-sm text-center text-muted-foreground">
                {t("didntReceiveEmail") || "Didn't receive the email?"}{" "}
                <button 
                  onClick={() => setIsSent(false)}
                  className="text-primary hover:underline font-medium"
                >
                  {t("tryAgain") || "Try again"}
                </button>
              </p>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
