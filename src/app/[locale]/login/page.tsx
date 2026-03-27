"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth-client";
import { Link } from "@/i18n/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";

import { loginSchema, type LoginInput } from "@/lib/validations/auth";
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
import { SocialAuth } from "@/components/auth/social-auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    try {
      const { error } = await signIn.email({
        email: data.email,
        password: data.password,
        callbackURL: "/dashboard",
      });

      if (error) {
        toast.error("Invalid email or password");
        return;
      }

      toast.success("Welcome back!");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-dvh flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/30">
      
      {/* ── Top Navigation / Utility Bar ── */}
      <div className="absolute top-0 left-0 w-full p-4 sm:p-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground hover:text-foreground">
          <Link href="/">
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
        {/* Logo area */}
        <div className="flex flex-col items-center gap-3">
          <Logo size={48} className="text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Pearfect S.L.</h1>
        </div>

        {/* Form Card */}
        <Card className="border-border/60 shadow-2xl shadow-black/5 bg-background/80 backdrop-blur-xl">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl font-semibold tracking-tight">{t("loginTitle")}</CardTitle>
            <CardDescription className="text-sm mt-2">
              {t("loginDescription")}
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <div className="space-y-2.5">
                <Label htmlFor="email" className="text-sm font-medium">{t("emailLabel")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  autoComplete="email"
                  className="bg-muted/30 focus-visible:bg-transparent transition-colors"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">{t("passwordLabel")}</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("passwordPlaceholder")}
                  autoComplete="current-password"
                  className="bg-muted/30 focus-visible:bg-transparent transition-colors"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-6 pt-2">
              <Button type="submit" className="w-full shadow-md shadow-primary/20 h-10" disabled={isLoading}>
                {isLoading && <Loader2 className="size-4 animate-spin mr-2" />}
                {isLoading ? t("signingIn") : tc("signIn")}
              </Button>

              <SocialAuth />

              <p className="text-sm text-muted-foreground text-center mt-2">
                {t("noAccount")}{" "}
                <Link
                  href="/signup"
                  className="font-medium text-primary hover:text-primary hover:underline underline-offset-4 transition-all"
                >
                  {tc("signUp")}
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
