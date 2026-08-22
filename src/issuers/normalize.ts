/** Normalize issuer names for grouping dual-listed / multi-class siblings. */
export function normalizeIssuerName(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/\b(PLC|LTD|LIMITED|INC|CORP|CORPORATION|CO|NV|SA|AG|LP|LLC)\b\.?/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugFromNormalizedName(normalized: string): string {
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
