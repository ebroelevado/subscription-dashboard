import { hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Providers } from "@/components/providers";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  
  // Handle invalid locales like "favicon.ico" that Vinext might route here
  if (!hasLocale(routing.locales, locale)) {
    return {
      title: "Pearfect S.L.",
      description: "Professional Subscription Management",
    };
  }
  
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  const t = messages.metadata;

  return {
    title: t.title,
    description: t.description,
    metadataBase: new URL("https://pearfect.net"),
    openGraph: {
      title: t.ogTitle,
      description: t.ogDescription,
      type: "website",
    },
  };
}

// Load messages with fallback for Vinext compatibility
// next-intl/server getMessages() requires Next.js request context
// which Vinext may not fully polyfill
async function loadMessages(locale: string) {
  // Validate locale before loading
  if (!hasLocale(routing.locales, locale)) {
    // Return empty messages for invalid locales
    return {};
  }
  
  try {
    return await getMessages();
  } catch (e) {
    // Fallback: load messages directly from JSON file
    console.warn(`getMessages() failed, loading messages from file for locale: ${locale}`);
    const messages = (await import(`../../../messages/${locale}.json`)).default;
    return messages;
  }
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await loadMessages(locale);

  // Pass locale and messages to client-side Providers component
  // This ensures NextIntlClientProvider is rendered on the client side
  // and can properly provide context to useTranslations() hooks
  return (
    <Providers locale={locale} messages={messages}>
      {children}
    </Providers>
  );
}
