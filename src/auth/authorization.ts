import type { AppUser, UserPlan } from "./types.js";

/**
 * Server-side premium gate. Use this (or requirePremiumUser) on API handlers —
 * never trust a client-side `user.plan === "premium"` check alone.
 *
 * When Stripe is wired, extend this to also consult subscription_status /
 * current_period_end without changing call sites.
 */
export function canAccessPremiumContent(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  if (user.plan !== "premium") return false;

  // Future Stripe: treat canceled-but-still-in-period as allowed.
  if (user.subscriptionStatus) {
    const status = user.subscriptionStatus.toLowerCase();
    if (status === "active" || status === "trialing") return true;
    if (status === "canceled" || status === "cancelled") {
      if (user.subscriptionCurrentPeriodEnd) {
        const end = Date.parse(user.subscriptionCurrentPeriodEnd);
        if (Number.isFinite(end) && end > Date.now()) return true;
      }
      return false;
    }
    // unknown status with plan=premium — allow until billing is enforced
  }

  return true;
}

export function isFreePlan(user: AppUser | null | undefined): boolean {
  return !canAccessPremiumContent(user);
}

export function normalizePlan(raw: unknown): UserPlan {
  return String(raw || "").toLowerCase() === "premium" ? "premium" : "free";
}
