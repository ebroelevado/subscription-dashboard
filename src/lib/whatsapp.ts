import { differenceInDays, startOfDay, format } from "date-fns";

export type Lang = "es" | "en" | "zh";

export interface SeatWhatsAppContext {
  customPrice: number;
  activeUntil: string;
  platformName: string;
}

export function buildWhatsAppUrl(
  phone: string,
  name: string,
  seats: SeatWhatsAppContext[],
  lang: Lang,
  t: (key: string, values?: Record<string, string | number>) => string,
  currency = "EUR",
  forceAll = false
): string {
  const today = startOfDay(new Date());
  const URGENCY_THRESHOLD = 5;

  const urgentSeats = seats.filter((s) => {
    const diff = differenceInDays(startOfDay(new Date(s.activeUntil)), today);
    return diff <= URGENCY_THRESHOLD;
  });

  const relevantSeats = forceAll || urgentSeats.length === 0 ? seats : urgentSeats;

  const formatPrice = (amount: number) =>
    new Intl.NumberFormat(langToLocale(lang), {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

  const formatDate = (dateStr: string) =>
    format(startOfDay(new Date(dateStr)), "dd/MM/yyyy");

  const getDiff = (dateStr: string) =>
    differenceInDays(startOfDay(new Date(dateStr)), today);

  const getDaysText = (dateStr: string) => {
    const diff = getDiff(dateStr);
    if (diff < 0) return t("common.daysOverdue", { count: Math.abs(diff) });
    if (diff === 0) return t("common.today");
    return t("common.daysLeft", { count: diff });
  };

  // Group by expiry date to deduplicate same-day expirations
  const byDate = new Map<string, SeatWhatsAppContext[]>();
  for (const s of relevantSeats) {
    const key = formatDate(s.activeUntil);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(s);
  }

  const sortedGroups = [...byDate.entries()].sort((a, b) =>
    new Date(a[1][0].activeUntil).getTime() - new Date(b[1][0].activeUntil).getTime()
  );

  const totalPrice = relevantSeats.reduce((s, x) => s + x.customPrice, 0);
  const isMulti = relevantSeats.length > 1;

  const lines: string[] = [];
  for (const [date, group] of sortedGroups) {
    const daysText = getDaysText(group[0].activeUntil);
    const isOverdue = getDiff(group[0].activeUntil) < 0;
    const lineKey = isOverdue ? "clients.reminderLineOverdue" : "clients.reminderLine";

    for (const s of group) {
      lines.push(t(lineKey, {
        platform: s.platformName,
        price: formatPrice(s.customPrice),
        date,
        daysText,
      }));
    }
  }

  const detailBlock = lines.join("\n");
  const totalLine = isMulti
    ? "\n" + t("clients.reminderTotal", { total: formatPrice(totalPrice) })
    : "";

  const msg = t("clients.whatsappTemplate", { name, detailBlock, totalLine });

  const cleanPhone = phone.replace(/[\s\-()]/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

function langToLocale(lang: Lang): string {
  switch (lang) {
    case "es": return "es-ES";
    case "en": return "en-GB";
    case "zh": return "zh-CN";
  }
}
