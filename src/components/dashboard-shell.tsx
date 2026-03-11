"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { signOut, useSession } from "next-auth/react";
import {
  LayoutDashboard,
  Layers,
  Users,
  CreditCard,
  Repeat,
  Menu,
  LogOut,
  ScrollText,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/command-palette";
import { useEffect, useState, useCallback } from "react";
import { usePrefetch } from "@/hooks/use-prefetch";
import { Logo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { CurrencySelector } from "@/components/currency-selector";

// ── Sidebar dimensions ──
const SIDEBAR_EXPANDED = 260;
const SIDEBAR_COLLAPSED = 68;

const navItems = [
  { key: "dashboard" as const, href: "/dashboard", icon: LayoutDashboard },
  { key: "platforms" as const, href: "/dashboard/platforms", icon: Layers },
  { key: "plans" as const, href: "/dashboard/plans", icon: CreditCard },
  { key: "subscriptions" as const, href: "/dashboard/subscriptions", icon: Repeat },
  { key: "clients" as const, href: "/dashboard/clients", icon: Users },
  { key: "history" as const, href: "/dashboard/history", icon: ScrollText },
  { key: "analytics" as const, href: "/dashboard/analytics", icon: BarChart3 },
  { key: "assistant" as const, href: "/dashboard/assistant", icon: Bot },
  { key: "settings" as const, href: "/dashboard/settings", icon: Settings },
];

// ── Cookie helpers ──
const COOKIE_KEY = "sidebar-collapsed";

function readCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes(`${COOKIE_KEY}=1`);
}

function writeCookie(collapsed: boolean) {
  document.cookie = `${COOKIE_KEY}=${collapsed ? "1" : "0"}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

// ── Nav Links (desktop) ──
function NavLinks({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const prefetch = usePrefetch();

  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);

        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            onMouseEnter={() => prefetch(item.href)}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              collapsed && "size-12 p-0 justify-center gap-0 shrink-0",
              isActive
                ? "bg-primary/10 text-primary dark:bg-primary/15"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            {isActive && (
              <span className={cn(
                "absolute left-0 top-1/2 -translate-y-1/2 w-[3.5px] h-5 rounded-r-full bg-primary",
                collapsed && "-left-[10px]"
              )} />
            )}
            <item.icon
              className={cn(
                "size-4 shrink-0 transition-colors",
                isActive && "text-primary"
              )}
            />
            <span
              className={cn(
                "transition-opacity duration-200 whitespace-nowrap",
                collapsed ? "hidden" : "opacity-100"
              )}
            >
              {t(item.key)}
            </span>
          </Link>
        );

        return (
          <Tooltip key={item.href} open={collapsed ? undefined : false}>
            <TooltipTrigger asChild>
              <div className={cn(collapsed && "w-full flex justify-center")}>
                {link}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{t(item.key)}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

// ── Mobile Nav Links (no collapse / tooltip needed) ──
function MobileNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-primary/10 text-primary dark:bg-primary/15"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            {isActive && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3.5px] h-5 rounded-r-full bg-primary" />
            )}
            <item.icon
              className={cn(
                "size-4 shrink-0 transition-colors",
                isActive && "text-primary"
              )}
            />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}

// ── User Menu ──
function UserMenu({ collapsed }: { collapsed: boolean }) {
  const tc = useTranslations("common");
  const { data: session } = useSession();
  const user = session?.user;

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.charAt(0).toUpperCase() ?? "U";

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-3 px-3 py-2.5 h-auto transition-all",
            collapsed && "size-12 p-0 justify-center gap-0 shrink-0"
          )}
        >
          <Avatar className="size-8 shrink-0">
            {user?.image && <AvatarImage src={user.image} alt={user.name ?? ""} />}
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "flex flex-col items-start text-left overflow-hidden transition-opacity duration-200",
              collapsed ? "opacity-0 w-0" : "opacity-100"
            )}
          >
            <span className="text-sm font-medium truncate max-w-[140px]">
              {user?.name || tc("userDefault")}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[140px]">
              {user?.email}
            </span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? "right" : "top"}
        align="start"
        className="w-56"
      >
        <DropdownMenuLabel>{user?.name || tc("account")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/" })}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          {tc("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Tooltip open={collapsed ? undefined : false}>
      <TooltipTrigger asChild>
        <div className={cn(collapsed && "w-full flex justify-center")}>
          {menu}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        {user?.name || tc("userDefault")}
      </TooltipContent>
    </Tooltip>
  );
}

// Full-feature mobile user menu (always expanded look)
function MobileUserMenu() {
  const tc = useTranslations("common");
  const { data: session } = useSession();
  const user = session?.user;

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.charAt(0).toUpperCase() ?? "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-2.5 h-auto">
          <Avatar className="size-8">
            {user?.image && <AvatarImage src={user.image} alt={user.name ?? ""} />}
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-start text-left overflow-hidden">
            <span className="text-sm font-medium truncate max-w-[140px]">
              {user?.name || tc("userDefault")}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[140px]">
              {user?.email}
            </span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{tc("myAccount")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/" })}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          {tc("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


// ── Shell ──
export function DashboardShell({
  children,
  defaultCollapsed = false,
}: {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Sync cookie on mount (client may override SSR hint)
  useEffect(() => {
    const cookie = readCookie();
    if (cookie !== collapsed) setCollapsed(cookie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCookie(next);
      return next;
    });
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside
        style={{
          width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
          minWidth: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
        }}
        className="hidden lg:flex lg:flex-col border-r bg-sidebar/80 backdrop-blur-xl backdrop-saturate-150 transition-[width,min-width] duration-200 ease-in-out"
      >
        {/* Logo — h-14 matches the topbar height so borders align */}
        <div
          className={cn(
            "flex h-14 items-center gap-2.5 px-5 transition-all duration-200",
            collapsed && "justify-center px-0 gap-0"
          )}
        >
          <Logo size={28} className="text-primary shrink-0" />
          <span
            className={cn(
              "text-lg font-semibold tracking-tight text-foreground transition-opacity duration-200 whitespace-nowrap",
              collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
            )}
          >
            Pearfect S.L.
          </span>
        </div>

        <Separator />

        {/* Nav */}
        <div className={cn("flex-1 overflow-y-auto px-3 py-4 transition-all duration-200", collapsed && "px-2")}>
          <NavLinks collapsed={collapsed} />
        </div>

        <Separator />

        {/* Footer — toggle (left) + user menu (right) */}
        <div
          className={cn(
            "flex items-center gap-1 p-3",
            collapsed && "flex-col px-2"
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={toggleCollapse}
                aria-label={collapsed ? tc("expand") : tc("collapse")}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? tc("expand") : tc("collapse")}
            </TooltipContent>
          </Tooltip>

          <div className={cn("flex-1 min-w-0", collapsed && "w-full")}>
            <UserMenu collapsed={collapsed} />
          </div>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-14 items-center gap-3 border-b bg-background/70 backdrop-blur-xl backdrop-saturate-150 px-4 lg:px-6">
          {/* Mobile hamburger */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden size-8"
              >
                <Menu className="size-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 flex flex-col h-full bg-sidebar border-r-0">
              <div className="flex items-center gap-2.5 px-6 h-16 border-b shrink-0 bg-sidebar">
                <Logo size={28} className="text-primary" />
                <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">
                  Pearfect S.L.
                </span>
              </div>
              <div className="flex-1 overflow-y-auto pt-2 space-y-2">
                <div className="px-4 py-2">
                  <MobileNavLinks onNavigate={() => setSheetOpen(false)} />
                </div>
                <div className="px-4 pb-8 border-t mt-auto pt-6">
                  <MobileUserMenu />
                </div>
              </div>
            </SheetContent>
          </Sheet>

          <div className="flex-1" />

          <CommandPalette />
          <CurrencySelector variant="header" />
          <LanguageSwitcher />
          <ThemeToggle />
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
