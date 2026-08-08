/** Cluster role weights per product spec. */
const ROLE_WEIGHTS: ReadonlyArray<{ pattern: RegExp; weight: number; role: string }> = [
  { pattern: /\bceo\b|chief executive officer/i, weight: 1.0, role: "CEO" },
  { pattern: /\bchair(man|woman|person)?\b/i, weight: 0.9, role: "Chairman" },
  { pattern: /\bcfo\b|chief financial officer/i, weight: 0.85, role: "CFO" },
  { pattern: /\bpresident\b/i, weight: 0.8, role: "President" },
  { pattern: /\bcoo\b|chief operating officer/i, weight: 0.75, role: "COO" },
  { pattern: /\bdirector\b/i, weight: 0.5, role: "Director" },
  { pattern: /\bofficer\b|\bvp\b|\bvice president\b/i, weight: 0.4, role: "Officer" },
];

const OTHER_WEIGHT = 0.25;

export function clusterRoleWeight(title: string | null | undefined): number {
  const t = String(title || "").trim();
  if (!t) return OTHER_WEIGHT;
  for (const { pattern, weight } of ROLE_WEIGHTS) {
    if (pattern.test(t)) return weight;
  }
  return OTHER_WEIGHT;
}

export function isCeoRole(title: string | null | undefined): boolean {
  const t = String(title || "").trim();
  if (!t) return false;
  return /\bceo\b|chief executive officer/i.test(t);
}

export function primaryRoleLabel(title: string | null | undefined): string {
  const t = String(title || "").trim();
  if (!t) return "Other";
  for (const { pattern, role } of ROLE_WEIGHTS) {
    if (pattern.test(t)) return role;
  }
  return "Other";
}
