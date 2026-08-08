/** Stable slug identifier for a politician display name. */
export function politicianKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/^the honorable\s+/i, "")
    .replace(/^hon\.?\s+/i, "")
    .replace(/^rep\.?\s+/i, "")
    .replace(/^sen\.?\s+/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isBioguideId(id: string | null | undefined): boolean {
  return /^[A-Za-z]\d{6}$/.test(String(id || "").trim());
}
