export interface ParsedPoliticianName {
  first: string;
  last: string;
  middle?: string;
}

/** Strip honorifics and normalize whitespace for matching. */
export function normalizePoliticianDisplayName(name: string): string {
  return String(name || "")
    .replace(/^the honorable\s+/i, "")
    .replace(/^hon\.?\s+/i, "")
    .replace(/^rep\.?\s+/i, "")
    .replace(/^sen\.?\s+/i, "")
    .replace(/,+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePoliticianName(name: string): ParsedPoliticianName {
  const cleaned = normalizePoliticianDisplayName(name);
  if (!cleaned) return { first: "", last: "" };

  if (cleaned.includes(",")) {
    const [lastPart, rest] = cleaned.split(",", 2);
    const parts = rest.trim().split(/\s+/);
    return {
      last: lastPart.trim().toLowerCase(),
      first: (parts[0] || "").toLowerCase(),
      middle: parts.slice(1).join(" ").toLowerCase() || undefined,
    };
  }

  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { first: "", last: parts[0].toLowerCase() };
  return {
    first: parts[0].toLowerCase(),
    last: parts[parts.length - 1].toLowerCase(),
    middle: parts.slice(1, -1).join(" ").toLowerCase() || undefined,
  };
}

export function namesLikelyMatch(a: string, b: string): boolean {
  const pa = parsePoliticianName(a);
  const pb = parsePoliticianName(b);
  if (!pa.last || !pb.last) return false;
  if (pa.last !== pb.last) return false;
  if (pa.first && pb.first && pa.first[0] !== pb.first[0]) return false;
  return true;
}
