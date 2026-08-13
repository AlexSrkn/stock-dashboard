/**
 * Parse and compare 13F calendar quarters as "YYYY-Qn" keys.
 * Inclusive filter: latest quarter >= minimum_quarter.
 */

export interface ParsedFilingQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** Canonical key, e.g. "2026-Q1". */
  key: string;
  /** Original display label when parsed from text, e.g. "Q1 2026". */
  label: string;
}

const QUARTER_KEY_RE = /^(\d{4})-Q([1-4])$/i;
const QUARTER_LABEL_RE = /\bQ([1-4])\s+(\d{4})\b/i;
const QUARTER_SLUG_RE = /(?:^|-)q([1-4])-(\d{4})(?:$|-)/i;

export function normalizeQuarterKey(input: string): string | null {
  const parsed = parseFilingQuarter(input);
  return parsed?.key ?? null;
}

export function parseFilingQuarter(input: string | null | undefined): ParsedFilingQuarter | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const keyMatch = raw.match(QUARTER_KEY_RE);
  if (keyMatch) {
    const year = Number(keyMatch[1]);
    const quarter = Number(keyMatch[2]) as 1 | 2 | 3 | 4;
    return {
      year,
      quarter,
      key: `${year}-Q${quarter}`,
      label: `Q${quarter} ${year}`,
    };
  }

  const labelMatch = raw.match(QUARTER_LABEL_RE);
  if (labelMatch) {
    const quarter = Number(labelMatch[1]) as 1 | 2 | 3 | 4;
    const year = Number(labelMatch[2]);
    return {
      year,
      quarter,
      key: `${year}-Q${quarter}`,
      label: `Q${quarter} ${year}`,
    };
  }

  const slugMatch = raw.match(QUARTER_SLUG_RE);
  if (slugMatch) {
    const quarter = Number(slugMatch[1]) as 1 | 2 | 3 | 4;
    const year = Number(slugMatch[2]);
    return {
      year,
      quarter,
      key: `${year}-Q${quarter}`,
      label: `Q${quarter} ${year}`,
    };
  }

  return null;
}

export function quarterSortValue(keyOrLabel: string): number | null {
  const parsed = parseFilingQuarter(keyOrLabel);
  if (!parsed) return null;
  return parsed.year * 4 + parsed.quarter;
}

/** True when candidate quarter is the same as or later than minimum_quarter. */
export function isQuarterAtLeast(
  candidate: string | null | undefined,
  minimumQuarter: string
): boolean {
  const c = quarterSortValue(candidate || "");
  const m = quarterSortValue(minimumQuarter);
  if (c == null || m == null) return false;
  return c >= m;
}
