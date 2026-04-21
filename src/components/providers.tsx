"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { Toaster } from "sonner";
import { useState, type ReactNode, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

// Console noise suppression is handled in RootLayout head for early execution


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
