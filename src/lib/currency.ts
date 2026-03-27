export type Currency = 'EUR' | 'USD' | 'GBP' | 'CNY';

export const CURRENCIES: Record<Currency, { symbol: string, label: string }> = {
  EUR: { symbol: '€', label: 'Euro (€)' },
  USD: { symbol: '$', label: 'Dollar ($)' },
  GBP: { symbol: '£', label: 'Pound (£)' },
  CNY: { symbol: '¥', label: 'Yuan (¥)' },
};

/**
 * Convert integer cents to decimal amount
 * @param cents - Integer amount in cents (e.g., 1050 for €10.50)
 * @returns Decimal amount (e.g., 10.50)
 */
export function centsToAmount(cents: number | string): number {
  const num = typeof cents === 'string' ? parseInt(cents, 10) : cents;
  return num / 100;
}

/**
 * Convert decimal amount to integer cents
 * @param amount - Decimal amount (e.g., 10.50)
 * @returns Integer amount in cents (e.g., 1050)
 */
export function amountToCents(amount: number | string): number {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return Math.round(num * 100);
}

/**
 * Format currency amount for display
 * @param cents - Integer amount in cents (e.g., 1050 for €10.50)
 * @param currency - Currency code (EUR, USD, GBP, CNY)
 * @returns Formatted string (e.g., "€10.50")
 */
export function formatCurrency(cents: number | string, currency: string = 'EUR'): string {
  const num = centsToAmount(cents);
  const config = (CURRENCIES[currency as Currency] || CURRENCIES.EUR).symbol;
  
  // Format with 2 decimal places
  return `${config}${num.toFixed(2)}`;
}
