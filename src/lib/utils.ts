import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Discipline Score → color helper */
export function getScoreColor(score: number): string {
  if (score >= 9.5) return "text-green-600 dark:text-green-400";
  if (score >= 7.5) return "text-emerald-500 dark:text-emerald-400";
  if (score >= 5.0) return "text-yellow-500 dark:text-yellow-400";
  if (score >= 3.0) return "text-orange-500 dark:text-orange-400";
  return "text-red-500 dark:text-red-400";
}

export function getScoreLabel(score: number, t: (k: string) => string): string {
  if (score >= 9.5) return t("scoreExcellent");
  if (score >= 7.5) return t("scoreGood");
  if (score >= 5.0) return t("scoreAverage");
  if (score >= 3.0) return t("scoreBelowAverage");
  return t("scorePoor");
}
