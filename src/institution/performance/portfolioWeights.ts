import type { InstitutionHolding, InstitutionPortfolioSnapshot } from "./types.js";

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Build portfolio weight snapshots per institution and quarter.
 * Holdings with non-positive market value are excluded.
 */
export function buildPortfolioSnapshots(
  holdings: InstitutionHolding[]
): InstitutionPortfolioSnapshot[] {
  const byKey = new Map<string, Map<string, number>>();

  for (const row of holdings) {
    const ticker = String(row.ticker || "").trim().toUpperCase();
    const mv = Number(row.marketValue);
    if (!ticker || !Number.isFinite(mv) || mv <= 0) continue;

    const key = `${row.institutionId}::${row.quarter}`;
    const bucket = byKey.get(key) ?? new Map<string, number>();
    bucket.set(ticker, (bucket.get(ticker) ?? 0) + mv);
    byKey.set(key, bucket);
  }

  const snapshots: InstitutionPortfolioSnapshot[] = [];

  for (const [key, tickerValues] of byKey) {
    const [institutionId, quarter] = key.split("::");
    let total = 0;
    for (const mv of tickerValues.values()) total += mv;
    if (total <= 0) continue;

    const weights: Record<string, number> = {};
    for (const [ticker, mv] of tickerValues) {
      weights[ticker] = round6(mv / total);
    }

    snapshots.push({
      institutionId,
      quarter,
      weights,
      totalPortfolioValue: round6(total),
    });
  }

  return snapshots;
}

/** Map institutionId → quarter → snapshot */
export function indexPortfolioSnapshots(
  snapshots: InstitutionPortfolioSnapshot[]
): Map<string, Map<string, InstitutionPortfolioSnapshot>> {
  const out = new Map<string, Map<string, InstitutionPortfolioSnapshot>>();
  for (const snap of snapshots) {
    const byQ = out.get(snap.institutionId) ?? new Map();
    byQ.set(snap.quarter, snap);
    out.set(snap.institutionId, byQ);
  }
  return out;
}
