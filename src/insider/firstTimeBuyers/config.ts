/** Default gap (years) before a returning open-market buy qualifies. */
export const DEFAULT_MIN_YEARS_SINCE_LAST_BUY = 3;

/**
 * Role multipliers for First-Time Buyer scoring (same scale as Conviction Buys).
 */
export const FIRST_TIME_BUYER_ROLE_WEIGHTS = {
  CEO: 1.5,
  Founder: 1.45,
  Chairman: 1.35,
  CFO: 1.3,
  President: 1.25,
  Officer: 1.15,
  Director: 1.0,
  "10% Owner": 0.9,
  Other: 1.0,
} as const;

export type FirstTimeBuyerRoleKey = keyof typeof FIRST_TIME_BUYER_ROLE_WEIGHTS;

export const MAX_FIRST_TIME_BUYER_ROLE_WEIGHT = FIRST_TIME_BUYER_ROLE_WEIGHTS.CEO;

const ROLE_RULES: ReadonlyArray<{
  pattern: RegExp;
  role: FirstTimeBuyerRoleKey;
}> = [
  { pattern: /\bceo\b|chief executive officer/i, role: "CEO" },
  { pattern: /\bfounder\b/i, role: "Founder" },
  { pattern: /\bchair(man|woman|person)?\b/i, role: "Chairman" },
  { pattern: /\bcfo\b|chief financial officer/i, role: "CFO" },
  { pattern: /\bvp\b|\bvice president\b/i, role: "Officer" },
  { pattern: /\bpresident\b/i, role: "President" },
  { pattern: /\b10%\s*owner\b|\bten percent owner\b/i, role: "10% Owner" },
  { pattern: /\bofficer\b|\bcoo\b|\bcio\b|\bcto\b/i, role: "Officer" },
  { pattern: /\bdirector\b/i, role: "Director" },
];

export function resolveFirstTimeBuyerRole(
  title: string | null | undefined
): FirstTimeBuyerRoleKey {
  const t = String(title || "").trim();
  if (!t) return "Other";
  for (const { pattern, role } of ROLE_RULES) {
    if (pattern.test(t)) return role;
  }
  return "Other";
}

export function firstTimeBuyerRoleWeight(title: string | null | undefined): number {
  return FIRST_TIME_BUYER_ROLE_WEIGHTS[resolveFirstTimeBuyerRole(title)];
}

export function firstTimeBuyerRoleLabel(title: string | null | undefined): string {
  return resolveFirstTimeBuyerRole(title);
}
