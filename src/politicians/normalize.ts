import type { PoliticianTransactionCategory } from "./types.js";

/** Senate eFD (and some PDFs) put "--" / "N/A" in the ticker column when none applies. */
export function cleanPoliticianTicker(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (
    upper === "--" ||
    upper === "—" ||
    upper === "–" ||
    upper === "-" ||
    upper === "N/A" ||
    upper === "NA" ||
    upper === "NONE" ||
    upper === "NULL"
  ) {
    return null;
  }
  if (upper.length > 10) return null;
  if (!/^[A-Z][A-Z0-9./-]*$/.test(upper)) return null;
  return upper;
}

export function mapTransactionCategory(type: string): PoliticianTransactionCategory {
  const t = type.trim().toUpperCase();
  if (t.startsWith("P")) return "buy";
  if (t.startsWith("S")) return "sell";
  if (t.startsWith("E")) return "exchange";
  return "other";
}

export function parseAmountRange(range: string | null | undefined): {
  min: number | null;
  max: number | null;
} {
  if (!range) return { min: null, max: null };
  const nums = [...range.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!nums.length) return { min: null, max: null };
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
}

export function parseUsDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}
