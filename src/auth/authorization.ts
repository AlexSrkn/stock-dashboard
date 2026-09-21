import type { AppUser, UserPlan } from "./types.js";

/**
 * Server-side premium gate. Use this (or requirePremiumUser) on API handlers —
 * never trust a client-side `user.plan === "premium"` check alone.
 *
 * Entitlement comes from the session → DB user row (plan + subscription fields),
 * not from cookies the browser can invent.
 */
export function canAccessPremiumContent(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  // Admins can preview Premium sections without a paid plan.
  if (user.role === "admin") return true;
  if (user.plan !== "premium") return false;

  const status = String(user.subscriptionStatus || "").toLowerCase();

  if (status === "active" || status === "trialing" || status === "past_due") return true;

  if (status === "canceled" || status === "cancelled") {
    if (user.subscriptionCurrentPeriodEnd) {
      const end = Date.parse(user.subscriptionCurrentPeriodEnd);
      if (Number.isFinite(end) && end > Date.now()) return true;
    }
    return false;
  }

  // Paid Checkout fulfillment stores a subscription id; require it when status is unset.
  if (user.stripeSubscriptionId) return true;

  // No Stripe subscription and no active status → not entitled.
  return false;
}

export function isFreePlan(user: AppUser | null | undefined): boolean {
  return !canAccessPremiumContent(user);
}

export function normalizePlan(raw: unknown): UserPlan {
  return String(raw || "").toLowerCase() === "premium" ? "premium" : "free";
}
