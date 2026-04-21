"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { Toaster } from "sonner";
import { useState, type ReactNode, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

// Suppress noisy SES/lockdown warnings from AI SDK that don't affect functionality
if (typeof window !== "undefined") {
  const patchConsole = (method: keyof Console) => {
    const orig = console[method];
    (console[method] as any) = (...args: any[]) => {
      const fullMsg = args.map(a => String(a)).join(" ");
      if (
        fullMsg.includes("lockdown-install.js") || 
        fullMsg.includes("Removing intrinsics") || 
        fullMsg.includes("SES") ||
        fullMsg.includes("getOrInsert") ||
        fullMsg.includes("lockdown") ||
        fullMsg.includes("toTemporalInstant")
      ) return;
      if (typeof orig === "function") {
        orig.apply(console, args);
      }
    };
  };
  patchConsole("warn");
  patchConsole("log");
  patchConsole("info");
  patchConsole("error"); // Sometimes SES logs as error
}

interface ProvidersProps {
  children: ReactNode;
  locale?: string;
  messages?: Record<string, any>;
}

export function Providers({ children, locale, messages }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,            // always stale — refetch on mount after invalidation
            gcTime: 10 * 60 * 1000,  // 10 min — cache entries survive longer
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // better-auth doesn't need a SessionProvider - session is managed via useSession hook
  const content = (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400}>
          {children}
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              duration: 4000,
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );

  // If locale and messages are provided, wrap with NextIntlClientProvider
  if (locale && messages) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Europe/Madrid"
        formats={{
          dateTime: {
            short: { day: "numeric", month: "short", year: "numeric" },
          },
          number: {
            currency: { style: "currency", currency: "EUR" },
          },
        }}
      >
        {content}
      </NextIntlClientProvider>
    );
  }

  return content;
}
