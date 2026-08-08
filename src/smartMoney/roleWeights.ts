/** Insider role weights per product spec. */
const ROLE_WEIGHTS: ReadonlyArray<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bceo\b|chief executive/i, weight: 1.0 },
  { pattern: /\bcfo\b|chief financial/i, weight: 0.8 },
  { pattern: /\bchair(man|woman|person)?\b/i, weight: 0.9 },
  { pattern: /\bdirector\b/i, weight: 0.5 },
];

const DEFAULT_INSIDER_WEIGHT = 0.3;

export function insiderRoleWeight(title: string | null | undefined): number {
  const t = String(title || "").trim();
  if (!t) return DEFAULT_INSIDER_WEIGHT;
  for (const { pattern, weight } of ROLE_WEIGHTS) {
    if (pattern.test(t)) return weight;
  }
  return DEFAULT_INSIDER_WEIGHT;
}

export function signedTransactionValue(
  value: number | null | undefined,
  code: string,
  acquisitionDisposition: string | null | undefined
): number {
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0) return 0;
  const c = String(code || "").trim().toUpperCase();
  const ad = String(acquisitionDisposition || "").trim().toUpperCase();
  const isBuy = c === "P" || ad === "A";
  const isSell = c === "S" || ad === "D";
  if (isBuy) return Math.abs(v);
  if (isSell) return -Math.abs(v);
  return v;
}
