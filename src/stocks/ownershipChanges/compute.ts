import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import { SELECT_INSTITUTION_QUARTERS_BATCH_SQL } from "../../institution/performance/queries.js";
import { formatSecCik } from "../../sec/http.js";
import { sortQuarters } from "../../institution/performance/quarters.js";
import { trackedInstitutionCiks } from "../../institution/mostAccumulated/queries.js";
import { reloadTrackedInstitutions } from "../../ownership/trackedInstitutions.js";
import { SELECT_SHARES_OUTSTANDING_SQL, SELECT_STOCK_ENRICHMENT_SQL } from "./queries.js";
import type { OwnershipChangeRow, OwnershipChangesCachePayload } from "./types.js";

/** Keep peak Node heap low on the 4GB VPS while covering the full tracked universe. */
const CIK_BATCH_SIZE = 120;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundShares(n: number): number {
  return Math.round(n);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function normalizeExchange(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper.includes("NASDAQ")) return "NASDAQ";
  if (upper.includes("NYSE AMERICAN") || upper === "AMEX" || upper.includes("AMERICAN")) {
    return "NYSE American";
  }
  if (upper.includes("NYSE")) return "NYSE";
  if (upper.includes("OTC") || upper.includes("PINK")) return "OTC";
  return value;
}

export function inferExchangeFromTicker(ticker: string): string {
  if (/\./.test(ticker)) return "Other";
  return "US Listed";
}

function matchesMarketCap(marketCapUsd: number | null, bucket: string): boolean {
  if (!bucket) return true;
  const v = Number(marketCapUsd);
  if (!Number.isFinite(v) || v <= 0) return false;
  if (bucket === "mega") return v >= 200e9;
  if (bucket === "large") return v >= 10e9 && v < 200e9;
  if (bucket === "mid") return v >= 2e9 && v < 10e9;
  if (bucket === "small") return v < 2e9;
  return true;
}

interface StockMeta {
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
}

interface TickerQuarterAgg {
  shares: number;
  valueUsd: number;
  institutionCount: number;
}

/** Per-quarter ticker aggregates + institution sets (for unique holder counts). */
type QuarterAggState = {
  byTicker: Map<string, TickerQuarterAgg>;
  seen: Map<string, Set<string>>;
  institutions: Set<string>;
};

function ensureQuarterState(map: Map<string, QuarterAggState>, quarter: string): QuarterAggState {
  let state = map.get(quarter);
  if (!state) {
    state = { byTicker: new Map(), seen: new Map(), institutions: new Set() };
    map.set(quarter, state);
  }
  return state;
}

function mergeHoldingsIntoQuarterAggs(
  quarterAggs: Map<string, QuarterAggState>,
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>
): void {
  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares) || h.shares <= 0) continue;
    const ticker = String(h.ticker).trim().toUpperCase();
    const state = ensureQuarterState(quarterAggs, h.quarter);
    const instKey = formatSecCik(h.institutionId);
    state.institutions.add(instKey);

    let agg = state.byTicker.get(ticker);
    if (!agg) {
      agg = { shares: 0, valueUsd: 0, institutionCount: 0 };
      state.byTicker.set(ticker, agg);
      state.seen.set(ticker, new Set());
    }
    agg.shares += h.shares;
    agg.valueUsd += Number.isFinite(h.marketValue) ? h.marketValue : 0;
    const instSet = state.seen.get(ticker)!;
    if (!instSet.has(instKey)) {
      instSet.add(instKey);
      agg.institutionCount += 1;
    }
  }
}

function buildPairRows(
  currentQuarter: string,
  previousQuarterLabel: string,
  current: Map<string, TickerQuarterAgg>,
  previous: Map<string, TickerQuarterAgg>,
  sharesOutstanding: Map<string, number>,
  stockMeta: Map<string, StockMeta>
): OwnershipChangeRow[] {
  const rows: OwnershipChangeRow[] = [];

  for (const [ticker, cur] of current) {
    const prev = previous.get(ticker);
    if (!prev || prev.shares <= 0 || cur.shares <= 0) continue;

    const so = sharesOutstanding.get(ticker);
    const currentOwnershipPct =
      so && so > 0 ? round2((cur.shares / so) * 100) : null;
    const previousOwnershipPct =
      so && so > 0 ? round2((prev.shares / so) * 100) : null;
    const changePct =
      currentOwnershipPct != null && previousOwnershipPct != null
        ? round2(currentOwnershipPct - previousOwnershipPct)
        : round2(((cur.shares - prev.shares) / prev.shares) * 100);
    if (!Number.isFinite(changePct) || changePct === 0) continue;

    const meta = stockMeta.get(ticker);
    const impliedPx = cur.shares > 0 ? cur.valueUsd / cur.shares : null;
    const marketCapUsd =
      so && so > 0 && impliedPx != null && impliedPx > 0 ? round2(so * impliedPx) : null;

    rows.push({
      ticker,
      companyName: meta?.companyName ?? null,
      sector: meta?.sector ?? null,
      exchange: meta?.exchange ?? inferExchangeFromTicker(ticker),
      marketCapUsd,
      currentOwnershipPct,
      previousOwnershipPct,
      changePct,
      institutionCount: cur.institutionCount,
      totalInstitutionalShares: roundShares(cur.shares),
      currentQuarter,
      previousQuarter: previousQuarterLabel,
    });
  }

  return rows.sort((a, b) => b.changePct - a.changePct || a.ticker.localeCompare(b.ticker));
}

async function loadSharesOutstanding(pool: pg.Pool): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await pool.query<{ ticker: string; shares_outstanding: number | null }>(
      SELECT_SHARES_OUTSTANDING_SQL
    );
    for (const row of res.rows) {
      const so = Number(row.shares_outstanding);
      if (Number.isFinite(so) && so > 0) out.set(String(row.ticker).toUpperCase(), so);
    }
  } catch {
    /* optional */
  }
  return out;
}

async function loadStockMeta(pool: pg.Pool, tickers: string[]): Promise<Map<string, StockMeta>> {
  const out = new Map<string, StockMeta>();
  if (!tickers.length) return out;
  for (const batch of chunkArray(tickers, 2000)) {
    const res = await pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
      cik: string | null;
    }>(SELECT_STOCK_ENRICHMENT_SQL, [batch]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        companyName: row.company_name ? String(row.company_name) : null,
        sector: row.sector ? String(row.sector) : null,
        exchange: inferExchangeFromTicker(String(row.ticker).toUpperCase()),
      });
    }
  }
  return out;
}

async function loadTrackedQuarters(pool: pg.Pool, ciks: string[], maxQuarters: number): Promise<string[]> {
  const quarters = new Set<string>();
  for (const batch of chunkArray(ciks, CIK_BATCH_SIZE)) {
    const res = await pool.query<{ quarter: string }>(SELECT_INSTITUTION_QUARTERS_BATCH_SQL, [batch]);
    for (const row of res.rows) quarters.add(String(row.quarter));
  }
  return sortQuarters([...quarters]).slice(-maxQuarters);
}

/**
 * Full-universe ownership movers. Loads holdings in CIK batches and aggregates
 * per quarter so the job fits on a 4GB VPS (unlike a single all-CIK query).
 */
export async function computeOwnershipChangesCache(
  pool: pg.Pool = getPool()
): Promise<OwnershipChangesCachePayload> {
  reloadTrackedInstitutions(true);
  const ciks = trackedInstitutionCiks();
  if (ciks.length < 100) {
    throw new Error(
      `Tracked institution universe too small (${ciks.length}). Ensure data/13f-info/imported-tracked-managers.json is present, then retry.`
    );
  }

  const quarters = await loadTrackedQuarters(pool, ciks, 8);
  if (quarters.length < 2) {
    throw new Error("Need at least two 13F quarters to compute ownership changes.");
  }

  const quarterAggs = new Map<string, QuarterAggState>();
  for (const batch of chunkArray(ciks, CIK_BATCH_SIZE)) {
    const holdings = await loadInstitutionHoldings(pool, batch, { quarters });
    mergeHoldingsIntoQuarterAggs(quarterAggs, holdings);
  }

  const sharesOutstanding = await loadSharesOutstanding(pool);
  const allTickers = [
    ...new Set([...quarterAggs.values()].flatMap((s) => [...s.byTicker.keys()])),
  ];
  const stockMeta = await loadStockMeta(pool, allTickers);

  const byQuarterRaw: Record<string, OwnershipChangeRow[]> = {};
  for (let i = 1; i < quarters.length; i++) {
    const currentQuarter = quarters[i];
    const previousQuarterLabel = quarters[i - 1];
    if (!currentQuarter || !previousQuarterLabel) continue;
    const current = quarterAggs.get(currentQuarter)?.byTicker ?? new Map();
    const previous = quarterAggs.get(previousQuarterLabel)?.byTicker ?? new Map();
    byQuarterRaw[currentQuarter] = buildPairRows(
      currentQuarter,
      previousQuarterLabel,
      current,
      previous,
      sharesOutstanding,
      stockMeta
    );
  }

  const institutionCounts = new Map<string, number>();
  for (const [q, state] of quarterAggs) {
    institutionCounts.set(q, state.institutions.size);
  }

  const filtered = filterFullyScrapedOwnershipQuarters({
    quarters: quarters.slice().reverse(),
    byQuarter: byQuarterRaw,
    defaultQuarter: pickDefaultOwnershipQuarter(quarters.slice().reverse(), institutionCounts),
  });

  const sectors = [
    ...new Set(
      Object.values(filtered.byQuarter)
        .flat()
        .map((r) => r.sector)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ].sort((a, b) => a.localeCompare(b));

  const exchanges = [
    ...new Set(
      Object.values(filtered.byQuarter)
        .flat()
        .map((r) => r.exchange)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    computedAt: new Date().toISOString(),
    quarters: filtered.quarters,
    defaultQuarter: filtered.defaultQuarter,
    sectors,
    exchanges,
    byQuarter: filtered.byQuarter,
  };
}

export function filterOwnershipChangeRows(
  rows: OwnershipChangeRow[],
  options: {
    direction: "increases" | "decreases";
    search?: string;
    sector?: string;
    exchange?: string;
    marketCap?: string;
  }
): OwnershipChangeRow[] {
  const q = String(options.search || "")
    .trim()
    .toLowerCase();

  let filtered = rows.filter((row) => {
    if (options.direction === "increases" && row.changePct <= 0) return false;
    if (options.direction === "decreases" && row.changePct >= 0) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (options.exchange && row.exchange !== options.exchange) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const name = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || name.includes(q);
  });

  return filtered;
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number): { rows: T[]; total: number } {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(200, Math.max(1, pageSize));
  const start = (safePage - 1) * safeSize;
  return {
    total: rows.length,
    rows: rows.slice(start, start + safeSize),
  };
}

export function buildOwnershipChangesSummary(rows: OwnershipChangeRow[]): {
  topIncrease: { ticker: string; companyName: string | null; changePct: number } | null;
  topDecrease: { ticker: string; companyName: string | null; changePct: number } | null;
  stockCount: number;
  averageChangePct: number | null;
} {
  if (!rows.length) {
    return { topIncrease: null, topDecrease: null, stockCount: 0, averageChangePct: null };
  }
  const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
  const topIncrease = sorted[0]
    ? { ticker: sorted[0].ticker, companyName: sorted[0].companyName, changePct: sorted[0].changePct }
    : null;
  const topDecrease = sorted[sorted.length - 1]
    ? {
        ticker: sorted[sorted.length - 1].ticker,
        companyName: sorted[sorted.length - 1].companyName,
        changePct: sorted[sorted.length - 1].changePct,
      }
    : null;
  const avg = rows.reduce((sum, r) => sum + r.changePct, 0) / rows.length;
  return {
    topIncrease,
    topDecrease,
    stockCount: rows.length,
    averageChangePct: round2(avg),
  };
}

/**
 * 13F deadline is ~45 days after quarter-end. Treat a quarter as ready for
 * default ranking once that deadline plus a short late-filer grace has passed.
 */
export function isOwnershipQuarterLikelyComplete(
  quarter: string,
  now: Date = new Date()
): boolean {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(quarter || "").trim());
  if (!m) return true;
  const year = Number(m[1]);
  const q = Number(m[2]);
  // Day 0 of month (q*3) is the last day of the quarter (Mar/Jun/Sep/Dec).
  const quarterEnd = new Date(Date.UTC(year, q * 3, 0));
  const deadline = new Date(quarterEnd);
  deadline.setUTCDate(deadline.getUTCDate() + 45);
  const ready = new Date(deadline);
  ready.setUTCDate(ready.getUTCDate() + 14);
  return now.getTime() >= ready.getTime();
}

/** Sparse scrape history collapses toward ~0% ownership across most tickers. */
const MIN_OWNERSHIP_SAMPLE = 30;
const MAX_NEAR_ZERO_OWNERSHIP_FRAC = 0.15;
const MIN_MEDIAN_OWNERSHIP_PCT = 5;

/**
 * True when an ownership-% series looks like full 13F coverage (not a thin
 * historical scrape that reads as ~0% for almost every ticker).
 */
export function ownershipPctSeriesLooksComplete(values: number[]): boolean {
  if (values.length < MIN_OWNERSHIP_SAMPLE) return false;
  const nearZero = values.filter((v) => v < 1).length / values.length;
  if (nearZero > MAX_NEAR_ZERO_OWNERSHIP_FRAC) return false;
  const sorted = values.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return med >= MIN_MEDIAN_OWNERSHIP_PCT;
}

/**
 * Keep a QoQ slice only when both the current and previous quarters have
 * fully scraped ownership levels (drops cliff quarters and pairs that
 * compare against a sparse prior).
 */
export function isOwnershipQuarterPairDataComplete(rows: OwnershipChangeRow[]): boolean {
  if (!rows.length) return false;
  const current: number[] = [];
  const previous: number[] = [];
  for (const row of rows) {
    if (row.currentOwnershipPct != null && Number.isFinite(row.currentOwnershipPct)) {
      current.push(row.currentOwnershipPct);
    }
    if (row.previousOwnershipPct != null && Number.isFinite(row.previousOwnershipPct)) {
      previous.push(row.previousOwnershipPct);
    }
  }
  return ownershipPctSeriesLooksComplete(current) && ownershipPctSeriesLooksComplete(previous);
}

/**
 * Drop calendar-incomplete and sparsely scraped quarters from a cache payload
 * so the UI only offers usable time points.
 */
export function filterFullyScrapedOwnershipQuarters(
  payload: Pick<OwnershipChangesCachePayload, "quarters" | "byQuarter" | "defaultQuarter">,
  now: Date = new Date()
): {
  quarters: string[];
  byQuarter: Record<string, OwnershipChangeRow[]>;
  defaultQuarter: string | null;
} {
  const byQuarter: Record<string, OwnershipChangeRow[]> = {};
  for (const [quarter, rows] of Object.entries(payload.byQuarter || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;
    if (!isOwnershipQuarterLikelyComplete(quarter, now)) continue;
    if (!isOwnershipQuarterPairDataComplete(rows)) continue;
    byQuarter[quarter] = rows;
  }

  const listed = Array.isArray(payload.quarters) ? payload.quarters : [];
  const quartersNewestFirst = sortQuarters([
    ...new Set([...listed.filter((q) => byQuarter[q]), ...Object.keys(byQuarter)]),
  ]).reverse();

  const defaultQuarter = pickDefaultOwnershipQuarter(quartersNewestFirst, new Map(), now);

  return { quarters: quartersNewestFirst, byQuarter, defaultQuarter };
}

export function countInstitutionsByQuarter(
  holdings: Array<{ quarter: string; institutionId: string }>
): Map<string, number> {
  const byQuarter = new Map<string, Set<string>>();
  for (const h of holdings) {
    const q = String(h.quarter || "");
    if (!q) continue;
    let set = byQuarter.get(q);
    if (!set) {
      set = new Set();
      byQuarter.set(q, set);
    }
    set.add(formatSecCik(h.institutionId));
  }
  const out = new Map<string, number>();
  for (const [q, set] of byQuarter) out.set(q, set.size);
  return out;
}

/**
 * Newest quarter first. Skip sparse / still-filing quarters so "latest" does not
 * surface incomplete 13F drops (e.g. AAPL appearing to lose 30%+ ownership).
 */
export function pickDefaultOwnershipQuarter(
  quartersNewestFirst: string[],
  institutionCountByQuarter: Map<string, number> = new Map(),
  now: Date = new Date()
): string | null {
  if (!quartersNewestFirst.length) return null;

  for (let i = 0; i < quartersNewestFirst.length; i++) {
    const q = quartersNewestFirst[i]!;
    if (!isOwnershipQuarterLikelyComplete(q, now)) continue;

    const n = institutionCountByQuarter.get(q) ?? 0;
    const prev = quartersNewestFirst[i + 1];
    const prevN = prev ? institutionCountByQuarter.get(prev) ?? 0 : 0;

    // Coverage check only when we have filer counts for both quarters.
    if (institutionCountByQuarter.size > 0) {
      if (n <= 0) continue;
      if (prevN > 0 && n < prevN * 0.7) continue;
    }

    return q;
  }

  if (institutionCountByQuarter.size > 0) {
    const withFilers = quartersNewestFirst.find((q) => (institutionCountByQuarter.get(q) ?? 0) > 0);
    if (withFilers) return withFilers;
  }
  return quartersNewestFirst[0] ?? null;
}

export function parseOwnershipChangesQuarter(
  raw: string | null,
  available: string[],
  defaultQuarter?: string | null
): string | null {
  const fallback = defaultQuarter && available.includes(defaultQuarter)
    ? defaultQuarter
    : available[0] ?? null;
  if (!raw || raw === "latest") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  return available.includes(value) ? value : fallback;
}

export function parseOwnershipChangeDirection(raw: string | null): "increases" | "decreases" {
  return raw === "decreases" ? "decreases" : "increases";
}

export function parseMarketCapBucket(raw: string | null): string {
  if (raw === "mega" || raw === "large" || raw === "mid" || raw === "small") return raw;
  return "";
}
