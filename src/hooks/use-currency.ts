"use client";

import { useSession, authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { Currency } from "@/lib/currency";

export function useCurrency() {
  const { data: session } = useSession();
  const [guestCurrency, setGuestCurrency] = useState<Currency>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("NEXT_CURRENCY") as Currency;
      return stored || "EUR";
    }
    return "EUR";
  });

  const currentCurrency = session?.user?.currency || guestCurrency;

  const setCurrency = async (newCurrency: Currency) => {
    if (session?.user) {
      await authClient.updateUser({
        currency: newCurrency,
      });
    } else {
      localStorage.setItem("NEXT_CURRENCY", newCurrency);
      setGuestCurrency(newCurrency);
      // Dispatch an event so other components on the page can update
      window.dispatchEvent(new CustomEvent("currency-change", { detail: newCurrency }));
    }
  };

  // Listen for guest currency changes from other components
  useEffect(() => {
    const handleGuestChange = (e: Event) => {
      const customEvent = e as CustomEvent<Currency>;
      setGuestCurrency(customEvent.detail);
    };
    window.addEventListener("currency-change", handleGuestChange);
    return () => window.removeEventListener("currency-change", handleGuestChange);
  }, []);

  return {
    currency: currentCurrency as Currency,
    setCurrency,
    isGuest: !session?.user,
  };
}
