"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, useInView } from "framer-motion";
import {
  ArrowRight,
  Users,
  TrendingUp,
  MessageCircle,
  Shield,
  BarChart3,
  Zap,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { Link } from "@/i18n/navigation";
import { useSession } from "@/lib/auth-client";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { CurrencySelector } from "@/components/currency-selector";
import { useCurrency } from "@/hooks/use-currency";

/* ─── animation helpers ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" as const },
  }),
};

function AnimatedSection({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <div ref={ref} className={className}>
      {isInView ? children : <div className="opacity-0">{children}</div>}
    </div>
  );
}

/* ─── feature keys ─── */
const featureKeys = [
  {
    titleKey: "seatManagement" as const,
    descKey: "seatManagementDesc" as const,
    icon: Users,
    gradient: "from-blue-500/10 to-indigo-500/10",
    iconColor: "text-blue-600",
  },
  {
    titleKey: "automaticProfitability" as const,
    descKey: "automaticProfitabilityDesc" as const,
    icon: TrendingUp,
    gradient: "from-emerald-500/10 to-teal-500/10",
    iconColor: "text-emerald-600",
  },
  {
    titleKey: "whatsappReminders" as const,
    descKey: "whatsappRemindersDesc" as const,
    icon: MessageCircle,
    gradient: "from-green-500/10 to-lime-500/10",
    iconColor: "text-green-600",
  },
];

const trustKeys = [
  { icon: Shield, key: "secureByDefault" as const },
  { icon: BarChart3, key: "realtimeAnalytics" as const },
  { icon: Zap, key: "lightningFast" as const },
];

/* ─── page ─── */
export default function LandingPage() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const { data: session, isPending } = useSession();
  const { currency } = useCurrency();

  return (
    <div className="min-h-dvh bg-background text-foreground overflow-x-hidden">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Logo size={32} className="text-primary transition-transform group-hover:scale-105" />
            <span className="text-lg font-semibold tracking-tight hidden sm:inline">
              pearfect.net
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 mr-2 border-r pr-2 shadow-none border-border/50">
               <CurrencySelector variant="header" />
               <LanguageSwitcher />
               <ThemeToggle />
            </div>
            {isPending ? (
              <Button variant="ghost" size="sm" disabled>
                ...
              </Button>
            ) : session?.user ? (
              <Button size="sm" asChild>
                <Link href="/dashboard">
                  {tc("dashboardShortcut")}
                  <ArrowRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/login">{tc("signIn")}</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/signup">
                    {tc("getStarted")}
                    <ArrowRight className="ml-1 size-3.5" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative px-4 sm:px-6">
        {/* subtle radial gradient */}
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[800px] rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl pt-20 pb-16 sm:pt-28 sm:pb-20 text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={0}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-6">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {t("badge")}
            </span>
          </motion.div>

          <motion.h1
            className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-[1.1]"
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
          >
            {t("heroTitle")}{" "}
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
              {t("heroHighlight")}
            </span>
          </motion.h1>

          <motion.p
            className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
          >
            {t("heroDescription", { 
              everyCurrency: t(`every${currency}`) || t("everyEUR")
            })}
          </motion.p>

          <motion.div
            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
          >
            {isPending ? (
               <Button size="lg" disabled className="w-full sm:w-auto shadow-lg shadow-primary/20">
               ...
             </Button>
            ) : session?.user ? (
              <Button size="lg" asChild className="w-full sm:w-auto shadow-lg shadow-primary/20">
                <Link href="/dashboard">
                  {tc("dashboardShortcut")}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild className="w-full sm:w-auto shadow-lg shadow-primary/20">
                  <Link href="/signup">
                    {tc("startForFree")}
                    <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild className="w-full sm:w-auto">
                  <Link href="/login">{tc("signIn")}</Link>
                </Button>
              </>
            )}
          </motion.div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="px-4 sm:px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <AnimatedSection className="text-center mb-12">
            <motion.h2
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={0}
            >
              {t("featuresTitle")}
            </motion.h2>
            <motion.p
              className="mt-3 text-muted-foreground max-w-xl mx-auto"
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={1}
            >
              {t("featuresDescription")}
            </motion.p>
          </AnimatedSection>

          <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
            {featureKeys.map((f, i) => (
              <AnimatedSection key={f.titleKey}>
                <motion.div
                  className={`group relative rounded-2xl border border-border/60 bg-gradient-to-br ${f.gradient} p-6 sm:p-8 transition-all hover:border-border hover:shadow-lg hover:shadow-black/5`}
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={i}
                >
                  <div
                    className={`inline-flex items-center justify-center size-10 rounded-xl bg-background shadow-sm border border-border/50 ${f.iconColor} mb-4`}
                  >
                    <f.icon className="size-5" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{t(f.titleKey)}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t(f.descKey)}
                  </p>
                </motion.div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust strip ── */}
      <section className="border-y border-border/50 bg-muted/30 px-4 sm:px-6 py-10 sm:py-14">
        <div className="mx-auto max-w-4xl">
          <AnimatedSection className="text-center">
            <motion.p
              className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-6"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              custom={0}
            >
              {t("builtForProfessionals")}
            </motion.p>
            <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
              {trustKeys.map((item, i) => (
                <motion.div
                  key={item.key}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeUp}
                  custom={i + 1}
                >
                  <item.icon className="size-4 text-primary/70" />
                  <span>{t(item.key)}</span>
                </motion.div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="px-4 sm:px-6 py-16 sm:py-24 bg-muted/10">
        <div className="mx-auto max-w-5xl">
          <AnimatedSection className="text-center mb-12">
            <motion.h2
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={0}
            >
              Simple, transparent pricing
            </motion.h2>
            <motion.p
              className="mt-3 text-muted-foreground max-w-xl mx-auto"
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={1}
            >
              Get full access to all features with our Premium plan. No hidden fees.
            </motion.p>
          </AnimatedSection>
          
          <div className="flex justify-center">
             <AnimatedSection>
               <motion.div 
                  className="rounded-2xl border border-primary/20 bg-background/50 shadow-xl overflow-hidden max-w-md w-full relative"
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={2}
               >
                 {/* Top accent */}
                 <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
                 
                 <div className="p-8 text-center sm:p-10">
                    <h3 className="text-xl font-bold text-foreground">Premium</h3>
                    <div className="mt-4 flex items-baseline justify-center text-5xl font-extrabold tracking-tight text-foreground">
                      $2.99
                      <span className="ml-1 text-xl font-medium text-muted-foreground">/mo</span>
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground">
                      Everything you need to manage your business.
                    </p>
                    
                    <ul className="mt-8 space-y-3 text-sm leading-6 text-foreground/80 text-left">
                      <li className="flex gap-x-3 items-center">
                        <Zap className="size-4 text-primary shrink-0" />
                        Unlimited Platforms & Subscriptions
                      </li>
                      <li className="flex gap-x-3 items-center">
                        <BarChart3 className="size-4 text-primary shrink-0" />
                        Advanced Analytics & Profitability
                      </li>
                      <li className="flex gap-x-3 items-center">
                        <Bot className="size-4 text-primary shrink-0" />
                        Full AI Assistant Access
                      </li>
                      <li className="flex gap-x-3 items-center">
                        <Shield className="size-4 text-primary shrink-0" />
                        Automated WhatsApp Reminders
                      </li>
                    </ul>
                    
                    <div className="mt-8">
                      <Button size="lg" className="w-full shadow-lg shadow-primary/20" asChild>
                        <Link href="/signup">
                          Get Premium
                        </Link>
                      </Button>
                    </div>
                 </div>
               </motion.div>
             </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-4 sm:px-6 py-16 sm:py-24">
        <AnimatedSection className="mx-auto max-w-2xl text-center">
          <motion.h2
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
          >
            {t("ctaTitle")}
          </motion.h2>
          <motion.p
            className="mt-3 text-muted-foreground"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={1}
          >
            {t("ctaDescription")}
          </motion.p>
          <motion.div
            className="mt-6"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={2}
          >
            {isPending ? (
             <Button size="lg" disabled className="shadow-lg shadow-primary/20">
               ...
             </Button>
            ) : session?.user ? (
              <Button size="lg" asChild className="shadow-lg shadow-primary/20">
                <Link href="/dashboard">
                  {tc("dashboardShortcut")}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            ) : (
              <Button size="lg" asChild className="shadow-lg shadow-primary/20">
                <Link href="/signup">
                  {tc("getStartedFree")}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            )}
          </motion.div>
        </AnimatedSection>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/50 px-4 sm:px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Logo size={18} className="text-muted-foreground/50" />
            <span>pearfect.net</span>
          </div>
          <span>{tc("allRightsReserved", { year: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </div>
  );
}
