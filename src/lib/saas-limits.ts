import { eq, and, count } from "drizzle-orm";
import { db } from "@/db";
import { users, platforms, clients, clientSubscriptions, subscriptions, plans } from "@/db/schema";
import { SAAS_LIMITS } from "./saas-constants";

export async function checkUserLimits(userId: string) {
  // Free for all!
  return { canCreate: true };
}

export async function checkPlanLimit(userId: string, _platformId: string) {
  return { canCreate: true };
}

export async function checkSubscriptionLimit(userId: string) {
  return { canCreate: true };
}
