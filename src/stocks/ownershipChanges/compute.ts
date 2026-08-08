import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import { formatSecCik } from "../../sec/http.js";
import { sortQuarters } from "../../institution/performance/quarters.js";
import { SELECT_SHARES_OUTSTANDING_SQL, SELECT_STOCK_ENRICHMENT_SQL } from "./queries.js";
import type { OwnershipChangeRow, OwnershipChangesCachePayload } from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundShares(n: number): number {
  return Math.round(n);
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

function aggregateQuarter(
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>,
  quarter: string
): Map<string, TickerQuarterAgg> {
  const byTicker = new Map<string, TickerQuarterAgg>();
  const seen = new Map<string, Set<string>>();

  for (const h of holdings) {
    if (h.quarter !== quarter || !h.ticker || h.shares == null || !Number.isFinite(h.shares) || h.shares <= 0) {
      continue;
    }
    const ticker = String(h.ticker).trim().toUpperCase();
    let agg = byTicker.get(ticker);
    if (!agg) {
      agg = { shares: 0, valueUsd: 0, institutionCount: 0 };
      byTicker.set(ticker, agg);
      seen.set(ticker, new Set());
    }
    agg.shares += h.shares;
    agg.valueUsd += Number.isFinite(h.marketValue) ? h.marketValue : 0;
    const instKey = formatSecCik(h.institutionId);
    const instSet = seen.get(ticker)!;
    if (!instSet.has(instKey)) {
      instSet.add(instKey);
      agg.institutionCount += 1;
    }
  }

  return byTicker;
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
    if (!so || so <= 0) continue;

    const currentOwnershipPct = round2((cur.shares / so) * 100);
    const previousOwnershipPct = round2((prev.shares / so) * 100);
    const changePct = round2(currentOwnershipPct - previousOwnershipPct);
    const meta = stockMeta.get(ticker);
    const impliedPx = cur.shares > 0 ? cur.valueUsd / cur.shares : null;
    const marketCapUsd =
      impliedPx != null && impliedPx > 0 ? round2(so * impliedPx) : null;

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
  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string | null;
    cik: string | null;
  }>(SELECT_STOCK_ENRICHMENT_SQL, [tickers]);
  for (const row of res.rows) {
    out.set(String(row.ticker).toUpperCase(), {
      companyName: row.company_name ? String(row.company_name) : null,
      sector: row.sector ? String(row.sector) : null,
      exchange: inferExchangeFromTicker(String(row.ticker).toUpperCase()),
    });
  }
  return out;
}

export async function computeOwnershipChangesCache(
  pool: pg.Pool = getPool()
): Promise<OwnershipChangesCachePayload> {
  const holdings = await loadInstitutionHoldings(pool);
  const quarters = sortQuarters([...new Set(holdings.map((h) => h.quarter))]);
  const sharesOutstanding = await loadSharesOutstanding(pool);

  const allTickers = [
    ...new Set(
      holdings
        .map((h) => (h.ticker ? String(h.ticker).trim().toUpperCase() : ""))
        .filter(Boolean)
    ),
  ];
  const stockMeta = await loadStockMeta(pool, allTickers);

  const byQuarter: Record<string, OwnershipChangeRow[]> = {};
  for (let i = 1; i < quarters.length; i++) {
    const currentQuarter = quarters[i];
    const previousQuarterLabel = quarters[i - 1];
    if (!currentQuarter || !previousQuarterLabel) continue;
    const current = aggregateQuarter(holdings, currentQuarter);
    const previous = aggregateQuarter(holdings, previousQuarterLabel);
    byQuarter[currentQuarter] = buildPairRows(
      currentQuarter,
      previousQuarterLabel,
      current,
      previous,
      sharesOutstanding,
      stockMeta
    );
  }

  const sectors = [
    ...new Set(
      Object.values(byQuarter)
        .flat()
        .map((r) => r.sector)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ].sort((a, b) => a.localeCompare(b));

  const exchanges = [
    ...new Set(
      Object.values(byQuarter)
        .flat()
        .map((r) => r.exchange)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    computedAt: new Date().toISOString(),
    quarters: quarters.slice().reverse(),
    sectors,
    exchanges,
    byQuarter,
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

export function parseOwnershipChangesQuarter(
  raw: string | null,
  available: string[]
): string | null {
  if (!raw || raw === "latest") return available[0] ?? null;
  const value = raw.trim();
  if (!value) return available[0] ?? null;
  return available.includes(value) ? value : available[0] ?? null;
}

export function parseOwnershipChangeDirection(raw: string | null): "increases" | "decreases" {
  return raw === "decreases" ? "decreases" : "increases";
}

export function parseMarketCapBucket(raw: string | null): string {
  if (raw === "mega" || raw === "large" || raw === "mid" || raw === "small") return raw;
  return "";
}
