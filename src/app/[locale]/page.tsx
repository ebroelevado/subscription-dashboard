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
  CheckCircle2,
  HelpCircle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { CurrencySelector } from "@/components/currency-selector";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCurrency } from "@/hooks/use-currency";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

/* ─── animations ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.21, 0.47, 0.32, 0.98] },
  }),
};

function AnimatedSection({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={fadeUp}
      custom={delay}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── page ─── */
export default function LandingPage() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const { data: session, isPending } = useSession();
  const { currency } = useCurrency();

  const problemPoints = ["problemPoint1", "problemPoint2", "problemPoint3"];
  const solutionPoints = [
    { title: "solutionPoint1Title", desc: "solutionPoint1Desc", icon: Zap },
    { title: "solutionPoint2Title", desc: "solutionPoint2Desc", icon: BarChart3 },
    { title: "solutionPoint3Title", desc: "solutionPoint3Desc", icon: Shield },
  ];
  const featureList = [
    { icon: Bot, key: "smartReminders" as const },
    { icon: MessageCircle, key: "aiChat" as const },
    { icon: BarChart3, key: "realtimeAnalytics" as const },
    { icon: Zap, key: "lightningFast" as const },
  ];
  const faqItems = [
    { q: "faq1Q", a: "faq1A" },
    { q: "faq2Q", a: "faq2A" },
    { q: "faq3Q", a: "faq3A" },
  ];

  return (
    <div className="min-h-dvh bg-background text-foreground selection:bg-primary/20">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Logo size={32} className="text-primary transition-transform group-hover:scale-105" />
            <span className="text-xl font-bold tracking-tight hidden sm:inline bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
              pearfect.net
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-3 mr-4 border-r pr-4 border-border/50">
               <CurrencySelector variant="header" />
               <LanguageSwitcher />
               <ThemeToggle />
            </div>
            {isPending ? (
              <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
            ) : session?.user ? (
              <Button size="sm" asChild className="rounded-full px-5">
                <Link href="/dashboard">
                  {tc("dashboard")}
                </Link>
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild className="rounded-full">
                  <Link href="/login">{tc("login")}</Link>
                </Button>
                <Button size="sm" asChild className="rounded-full px-5 shadow-lg shadow-primary/20">
                  <Link href="/signup">{tc("signup")}</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main>
        {/* ── Hero Section ── */}
        <section className="relative overflow-hidden pt-16 pb-24 lg:pt-32 lg:pb-40">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 pointer-events-none overflow-hidden">
             <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
             <div className="absolute bottom-[20%] right-[-5%] w-[30%] h-[30%] bg-emerald-500/5 rounded-full blur-[100px]" />
          </div>

          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div className="flex flex-col items-start gap-8">
                <AnimatedSection delay={0}>
                  <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 px-3 py-1 text-xs font-semibold rounded-full animate-in fade-in slide-in-from-bottom-2 duration-1000">
                    <span className="flex items-center gap-1.5">
                      <TrendingUp className="size-3" />
                      {t("heroBadge")}
                    </span>
                  </Badge>
                </AnimatedSection>
                
                <AnimatedSection delay={1}>
                  <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]">
                    {t("heroTitle")}
                    <span className="block text-primary mt-2">{t("heroSubtitle")}</span>
                  </h1>
                </AnimatedSection>

                <AnimatedSection delay={2}>
                  <p className="text-xl text-muted-foreground leading-relaxed max-w-xl">
                    {t("heroDescription")}
                  </p>
                </AnimatedSection>

                <AnimatedSection delay={3} className="flex flex-wrap gap-4 pt-4">
                  <Button size="lg" asChild className="rounded-full px-8 text-base h-14 shadow-xl shadow-primary/20 group">
                    <Link href="/signup">
                      {t("ctaMain")}
                      <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>
                  <Button variant="outline" size="lg" asChild className="rounded-full px-8 text-base h-14 bg-background/50 backdrop-blur-sm">
                    <Link href="#features">
                      {t("ctaSecondary")}
                    </Link>
                  </Button>
                </AnimatedSection>

                <AnimatedSection delay={4} className="mt-12 flex items-center gap-4">
                   <div className="flex -space-x-3">
                     {[1,2,3,4].map(i => (
                       <div key={i} className="size-10 rounded-full border-2 border-background bg-muted flex items-center justify-center overflow-hidden">
                         <img src={`https://i.pravatar.cc/100?u=${i}`} alt="user" className="size-full object-cover" />
                       </div>
                     ))}
                   </div>
                   <p className="text-sm text-muted-foreground font-medium">
                     {t("socialProof")}
                   </p>
                </AnimatedSection>
              </div>

              <div className="relative lg:block group/hero">
                <AnimatedSection delay={2} className="relative">
                  <div className="relative rounded-3xl overflow-hidden border border-border/50 shadow-2xl bg-muted/20 aspect-square sm:aspect-video lg:aspect-auto">
                    <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-transparent pointer-events-none z-10" />
                    <img
                      src="/images/hero-dashboard.png"
                      alt="Pearfect Dashboard"
                      className="w-full h-full object-cover transform transition-transform duration-1000 group-hover/hero:scale-[1.03]"
                    />
                  </div>
                  {/* floating elements */}
                  <div className="absolute -top-6 -right-6 bg-background/80 backdrop-blur-xl p-4 rounded-2xl border border-primary/20 shadow-2xl animate-float z-20">
                    <div className="flex items-center gap-3">
                      <div className="bg-emerald-500/10 p-2 rounded-lg">
                        <TrendingUp className="size-5 text-emerald-500" />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{t("roi")}</div>
                        <div className="text-lg font-bold">+12% Monthly</div>
                      </div>
                    </div>
                  </div>
                </AnimatedSection>
              </div>
            </div>
          </div>
        </section>

        {/* ── Problem Section ── */}
        <section className="py-24 bg-muted/30 relative">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl lg:text-4xl font-bold mb-4">{t("problemTitle")}</h2>
              <p className="text-muted-foreground text-lg">{t("problemSubtitle")}</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {problemPoints.map((point, i) => (
                <AnimatedSection key={point} delay={i}>
                  <Card className="border-none bg-background shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="pt-8 pb-8 flex flex-col items-center text-center">
                      <div className="bg-red-500/10 text-red-500 p-3 rounded-2xl mb-6">
                        <HelpCircle className="size-6" />
                      </div>
                      <p className="font-medium text-lg leading-snug">{t(point as any)}</p>
                    </CardContent>
                  </Card>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ── Solution Section ── */}
        <section id="features" className="py-24 lg:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <Badge className="mb-4 bg-primary/10 text-primary hover:bg-primary/20 border-none">{t("theSolution")}</Badge>
              <h2 className="text-3xl lg:text-5xl font-bold mb-6">{t("solutionTitle")}</h2>
              <p className="text-muted-foreground text-xl leading-relaxed">{t("solutionSubtitle")}</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-10">
              {solutionPoints.map((item, i) => (
                <AnimatedSection key={item.title} delay={i}>
                  <div className="flex flex-col gap-6 p-8 rounded-3xl bg-muted/30 border border-transparent hover:border-primary/20 transition-colors group">
                    <div className="bg-background size-14 rounded-2xl flex items-center justify-center shadow-sm group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <item.icon className="size-7" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold mb-3">{t(item.title as any)}</h3>
                      <p className="text-muted-foreground leading-relaxed">{t(item.desc as any)}</p>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ── About Us Section ── */}
        <section className="py-24 bg-primary text-primary-foreground overflow-hidden relative">
           <div className="absolute top-0 right-0 w-[50%] h-full opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent pointer-events-none" />
           <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative">
              <div className="grid lg:grid-cols-2 gap-16 items-center">
                 <div>
                    <h2 className="text-4xl lg:text-5xl font-bold mb-8">{t("aboutTitle")}</h2>
                    <p className="text-xl opacity-90 leading-relaxed mb-8">{t("aboutDescription1")}</p>
                    <p className="text-xl opacity-90 leading-relaxed">{t("aboutDescription2")}</p>
                    <div className="mt-10 flex items-center gap-6">
                       <div className="flex flex-col">
                          <span className="text-3xl font-bold">100k+</span>
                          <span className="text-sm opacity-70 uppercase tracking-widest">{t("activeUsers")}</span>
                       </div>
                       <div className="w-px h-12 bg-white/20" />
                       <div className="flex flex-col">
                          <span className="text-3xl font-bold">99.9%</span>
                          <span className="text-sm opacity-70 uppercase tracking-widest">{t("uptime")}</span>
                       </div>
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    {featureList.map((f, i) => (
                       <div key={f.key} className="bg-white/10 backdrop-blur-sm p-6 rounded-2xl border border-white/10 flex flex-col gap-4">
                          <f.icon className="size-8" />
                          <span className="font-bold">{t(f.key as any)}</span>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        </section>

        {/* ── Pricing Section ── */}
        <section id="pricing" className="py-24 lg:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <h2 className="text-4xl lg:text-5xl font-bold mb-6">{t("pricingTitle")}</h2>
              <p className="text-muted-foreground text-xl">{t("pricingSubtitle")}</p>
            </div>

            <div className="grid lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
              {/* Free Plan */}
              <AnimatedSection delay={0}>
                <Card className="h-full border-2 border-transparent hover:border-border transition-colors">
                  <CardContent className="p-10 flex flex-col h-full">
                    <div className="mb-8">
                      <h3 className="text-2xl font-bold mb-2">{t("pricingFreeName")}</h3>
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold">{currency === "EUR" ? "0€" : "$0"}</span>
                        <span className="text-muted-foreground">/{t("pricingMonth")}</span>
                      </div>
                    </div>
                    <ul className="space-y-4 mb-10 flex-grow">
                      {[1,2,3].map(i => (
                        <li key={i} className="flex items-center gap-3">
                          <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                          <span>{t(`pricingFreeFeature${i}` as any)}</span>
                        </li>
                      ))}
                    </ul>
                    <Button variant="outline" size="lg" className="w-full rounded-full h-12" asChild>
                      <Link href="/signup">{t("pricingGetStarted")}</Link>
                    </Button>
                  </CardContent>
                </Card>
              </AnimatedSection>

              {/* Premium Plan */}
              <AnimatedSection delay={1}>
                <Card className="h-full relative border-2 border-primary shadow-2xl shadow-primary/10">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                    {t("pricingPopular")}
                  </div>
                  <CardContent className="p-10 flex flex-col h-full">
                    <div className="mb-8">
                      <h3 className="text-2xl font-bold mb-2">{t("pricingPremiumName")}</h3>
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold">{currency === "EUR" ? "12€" : "$12"}</span>
                        <span className="text-muted-foreground">/{t("pricingMonth")}</span>
                      </div>
                    </div>
                    <ul className="space-y-4 mb-10 flex-grow">
                      {[1,2,3,4,5].map(i => (
                        <li key={i} className="flex items-center gap-3">
                          <CheckCircle2 className="size-5 text-primary shrink-0" />
                          <span className="font-medium">{t(`pricingPremiumFeature${i}` as any)}</span>
                        </li>
                      ))}
                    </ul>
                    <Button size="lg" className="w-full rounded-full h-12 shadow-lg shadow-primary/30" asChild>
                      <Link href="/signup">{t("pricingSubscribe")}</Link>
                    </Button>
                  </CardContent>
                </Card>
              </AnimatedSection>
            </div>
          </div>
        </section>

        {/* ── FAQ Section ── */}
        <section className="py-24 bg-muted/20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold mb-12 text-center">{t("faqTitle")}</h2>
            <Accordion type="single" collapsible className="w-full">
              {faqItems.map((item, i) => (
                <AccordionItem key={i} value={`item-${i}`} className="border-border/50">
                  <AccordionTrigger className="text-lg hover:no-underline font-semibold">{t(item.q as any)}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-base leading-relaxed">
                    {t(item.a as any)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="py-24 lg:py-32 relative overflow-hidden">
           <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
              <div className="bg-foreground text-background rounded-[3rem] p-12 lg:p-20 relative overflow-hidden text-center">
                 <div className="absolute top-0 right-0 w-full h-full opacity-20 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-primary via-transparent to-transparent pointer-events-none" />
                 <h2 className="text-4xl lg:text-6xl font-bold mb-8 relative z-10">{t("finalCTATitle")}</h2>
                 <p className="text-xl opacity-80 mb-10 max-w-2xl mx-auto relative z-10">{t("finalCTASubtitle")}</p>
                 <div className="flex flex-col sm:flex-row justify-center gap-4 relative z-10">
                    <Button size="lg" variant="secondary" className="rounded-full px-10 h-14 text-lg font-bold" asChild>
                       <Link href="/signup">{t("finalCTAButton")}</Link>
                    </Button>
                    <Button size="lg" variant="outline" className="rounded-full px-10 h-14 text-lg font-bold bg-transparent border-white/20 text-white hover:bg-white/10" asChild>
                       <Link href="/login">{tc("login")}</Link>
                    </Button>
                 </div>
              </div>
           </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t py-12 bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <Logo size={28} />
            <span className="font-bold text-lg">pearfect</span>
          </div>

          <div className="flex gap-8 text-sm font-medium text-muted-foreground">
            <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-primary transition-colors">Contact</Link>
          </div>

          <div className="flex flex-col items-center md:items-end gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              {tc("allRightsReserved", { year: new Date().getFullYear() })}
            </span>
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60">System Operational</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
