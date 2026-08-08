/** Default cluster window (calendar days) for multi-insider selling detection. */
export const DEFAULT_CLUSTER_WINDOW_DAYS = 30;

/** Minimum unique sellers in a window to flag cluster selling. */
export const DEFAULT_CLUSTER_MIN_SELLERS = 3;

export const EXECUTIVE_ROLES = new Set([
  "CEO",
  "Founder",
  "Chairman",
  "CFO",
  "President",
]);

const ROLE_RULES: ReadonlyArray<{ pattern: RegExp; role: string }> = [
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

export function resolveHeavySellingRole(title: string | null | undefined): string {
  const t = String(title || "").trim();
  if (!t) return "Other";
  for (const { pattern, role } of ROLE_RULES) {
    if (pattern.test(t)) return role;
  }
  return "Other";
}

export function isExecutiveRole(role: string): boolean {
  return EXECUTIVE_ROLES.has(role);
}
