/**
 * Role multipliers for Conviction Buys scoring.
 * Higher weight = stronger signal when that role buys open-market shares.
 */
export const CONVICTION_ROLE_WEIGHTS = {
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

export type ConvictionRoleKey = keyof typeof CONVICTION_ROLE_WEIGHTS;

export const MAX_CONVICTION_ROLE_WEIGHT = CONVICTION_ROLE_WEIGHTS.CEO;

const ROLE_RULES: ReadonlyArray<{
  pattern: RegExp;
  role: ConvictionRoleKey;
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

export function resolveConvictionRole(title: string | null | undefined): ConvictionRoleKey {
  const t = String(title || "").trim();
  if (!t) return "Other";
  for (const { pattern, role } of ROLE_RULES) {
    if (pattern.test(t)) return role;
  }
  return "Other";
}

export function convictionRoleWeight(title: string | null | undefined): number {
  return CONVICTION_ROLE_WEIGHTS[resolveConvictionRole(title)];
}

export function convictionRoleLabel(title: string | null | undefined): string {
  return resolveConvictionRole(title);
}
