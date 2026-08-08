const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

export function parseQuarter(quarter: string): { year: number; q: number } | null {
  const m = String(quarter || "").trim().match(QUARTER_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  if (!Number.isFinite(year) || q < 1 || q > 4) return null;
  return { year, q };
}

export function formatQuarter(year: number, q: number): string {
  return `${year}-Q${q}`;
}

export function compareQuarters(a: string, b: string): number {
  const pa = parseQuarter(a);
  const pb = parseQuarter(b);
  if (!pa && !pb) return String(a).localeCompare(String(b));
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.year !== pb.year) return pa.year - pb.year;
  return pa.q - pb.q;
}

export function sortQuarters(quarters: Iterable<string>): string[] {
  return [...new Set(quarters)].sort(compareQuarters);
}

export function previousQuarter(quarter: string): string | null {
  const p = parseQuarter(quarter);
  if (!p) return null;
  if (p.q === 1) return formatQuarter(p.year - 1, 4);
  return formatQuarter(p.year, p.q - 1);
}

export function nextQuarter(quarter: string): string | null {
  const p = parseQuarter(quarter);
  if (!p) return null;
  if (p.q === 4) return formatQuarter(p.year + 1, 1);
  return formatQuarter(p.year, p.q + 1);
}

export function expandQuarterRange(quarters: string[]): string[] {
  const sorted = sortQuarters(quarters);
  if (!sorted.length) return [];
  const out: string[] = [];
  let cursor: string | null = sorted[0];
  const last = sorted[sorted.length - 1];
  while (cursor && compareQuarters(cursor, last) <= 0) {
    out.push(cursor);
    cursor = nextQuarter(cursor);
  }
  return out;
}

export function quarterYear(quarter: string): number | null {
  return parseQuarter(quarter)?.year ?? null;
}

/** Calendar quarter boundaries (ISO dates, inclusive). */
export function quarterDateRange(quarter: string): { start: string; end: string } | null {
  const p = parseQuarter(quarter);
  if (!p) return null;
  const startMonth = (p.q - 1) * 3;
  const endMonth = startMonth + 2;
  const start = `${p.year}-${String(startMonth + 1).padStart(2, "0")}-01`;
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (isLeap(p.year)) daysInMonth[1] = 29;
  const endDay = daysInMonth[endMonth];
  const end = `${p.year}-${String(endMonth + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { start, end };
}

/** Quarters in the same calendar year from Q1 through `quarter` inclusive. */
export function quartersYtdThrough(quarter: string): string[] {
  const p = parseQuarter(quarter);
  if (!p) return [];
  const out: string[] = [];
  for (let q = 1; q <= p.q; q++) {
    out.push(formatQuarter(p.year, q));
  }
  return out;
}

/** Quarters spanned by holdings plus one follow-on quarter for return chaining. */
export function quartersForHoldings(holdings: { quarter: string }[]): string[] {
  const snapshotQuarters = sortQuarters(holdings.map((h) => h.quarter));
  const quarters = [...expandQuarterRange(snapshotQuarters)];
  const tail = quarters[quarters.length - 1];
  const follow = tail ? nextQuarter(tail) : null;
  if (follow) quarters.push(follow);
  return quarters;
}
