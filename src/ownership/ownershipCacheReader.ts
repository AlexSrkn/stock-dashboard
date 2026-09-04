import type pg from "pg";
import { previousQuarter } from "../institution/performance/quarters.js";
import { formatSecCik } from "../sec/http.js";
import { resolvePositionValueUsd } from "./holdingValue.js";
import {
  SELECT_OWNERSHIP_CACHE_BY_TICKER_SQL,
  SELECT_OWNERSHIP_HOLDINGS_BY_TICKER_SQL,
  SELECT_TRACKED_AGGREGATES_BY_FILER_FOR_CIKS_SQL,
  SELECT_FILER_SHARES_BY_CUSIP_QUARTER_SQL,
} from "./queries.js";
import type { FundHoldingAggregate } from "./types.js";

export interface OwnershipCacheSnapshot {
  ticker: string;
  currentQuarter: string;
  previousQuarter: string | null;
  sharesOutstanding: number | null;
  institutionCount: number;
  institutionalOwnershipPct: number | null;
  ownershipTrend: string | null;
  currentShares: number;
  previousShares: number;
  primaryCusip: string | null;
}

interface CacheRow {
  ticker: string;
  institutional_ownership_pct: number | null;
  ownership_trend: string | null;
  institution_count: number;
  current_shares: number | null;
  previous_shares: number | null;
  shares_outstanding: number | null;
  current_quarter: string | null;
  primary_cusip: string | null;
}

interface HoldingRow {
  filer_cik: string;
  fund_name: string;
  shares: number;
  ownership_pct: number | null;
}

interface PriorFilerRow {
  filer_cik: string;
  fund_name: string;
  shares: number;
  value_usd_thousands: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctOfOutstanding(shares: number, sharesOutstanding: number | null): number | null {
  if (!sharesOutstanding || sharesOutstanding <= 0) return null;
  return round2((shares / sharesOutstanding) * 100);
}

export function overlayHolderValues(
  holders: FundHoldingAggregate[],
  valued: Map<string, FundHoldingAggregate>
): FundHoldingAggregate[] {
  const byCik = new Map<string, FundHoldingAggregate>();
  for (const h of valued.values()) {
    if (h.filerCik) byCik.set(formatSecCik(h.filerCik), h);
  }
  return holders.map((h) => {
    const match =
      (h.filerCik ? byCik.get(formatSecCik(h.filerCik)) : undefined) ?? valued.get(h.fundName);
    if (match?.valueUsd == null) return h;
    return { ...h, valueUsd: match.valueUsd };
  });
}

export async function loadOwnershipCacheSnapshot(
  pool: pg.Pool,
  ticker: string
): Promise<OwnershipCacheSnapshot | null> {
  const sym = String(ticker || "").trim().toUpperCase();
  if (!sym) return null;
  const res = await pool.query<CacheRow>(SELECT_OWNERSHIP_CACHE_BY_TICKER_SQL, [sym]);
  const row = res.rows[0];
  if (!row?.current_quarter) return null;

  const sharesOutstanding =
    row.shares_outstanding != null && Number.isFinite(Number(row.shares_outstanding))
      ? Number(row.shares_outstanding)
      : null;

  return {
    ticker: sym,
    currentQuarter: String(row.current_quarter),
    previousQuarter: previousQuarter(String(row.current_quarter)),
    sharesOutstanding,
    institutionCount: Number(row.institution_count) || 0,
    institutionalOwnershipPct:
      row.institutional_ownership_pct != null &&
      Number.isFinite(Number(row.institutional_ownership_pct))
        ? round2(Number(row.institutional_ownership_pct))
        : null,
    ownershipTrend: row.ownership_trend ? String(row.ownership_trend) : null,
    currentShares: Number(row.current_shares) || 0,
    previousShares: Number(row.previous_shares) || 0,
    primaryCusip: row.primary_cusip ? String(row.primary_cusip).trim() : null,
  };
}

export async function fetchCachedTopHolders(
  pool: pg.Pool,
  ticker: string,
  sharesOutstanding: number | null,
  stockPrice: number | null,
  limit = 500,
  valueLookup?: { cusips: string[]; quarter: string }
): Promise<FundHoldingAggregate[]> {
  const sym = String(ticker || "").trim().toUpperCase();
  const cap = Math.min(20000, Math.max(1, limit));
  const res = await pool.query<HoldingRow>(SELECT_OWNERSHIP_HOLDINGS_BY_TICKER_SQL, [sym, cap]);
  const holders = res.rows.map((row) => {
    const shares = round2(Number(row.shares));
    const filerCik = formatSecCik(String(row.filer_cik));
    return {
      fundName: String(row.fund_name || filerCik),
      filerCik,
      shares,
      valueUsd: resolvePositionValueUsd(shares, null, stockPrice),
      pctOutstanding:
        row.ownership_pct != null && Number.isFinite(Number(row.ownership_pct))
          ? round2(Number(row.ownership_pct))
          : pctOfOutstanding(shares, sharesOutstanding),
    };
  });

  const ciks = holders.map((h) => h.filerCik).filter((c): c is string => Boolean(c));
  if (!valueLookup?.cusips.length || !valueLookup.quarter || !ciks.length) return holders;

  const valued = await fetchPreviousHoldersForCiks(
    pool,
    valueLookup.cusips,
    valueLookup.quarter,
    ciks,
    sharesOutstanding,
    stockPrice
  );
  return overlayHolderValues(holders, valued);
}

export async function fetchPreviousHoldersForCiks(
  pool: pg.Pool,
  cusips: string[],
  quarter: string,
  filerCiks: string[],
  sharesOutstanding: number | null,
  stockPrice: number | null
): Promise<Map<string, FundHoldingAggregate>> {
  const ciks = [...new Set(filerCiks.map((c) => formatSecCik(c)).filter(Boolean))];
  if (!cusips.length || !quarter || !ciks.length) return new Map();

  const res = await pool.query<PriorFilerRow>(SELECT_TRACKED_AGGREGATES_BY_FILER_FOR_CIKS_SQL, [
    cusips,
    quarter,
    ciks,
  ]);

  const out = new Map<string, FundHoldingAggregate>();
  for (const row of res.rows) {
    const shares = round2(Number(row.shares));
    const fundName = String(row.fund_name || formatSecCik(row.filer_cik));
    out.set(fundName, {
      fundName,
      filerCik: formatSecCik(String(row.filer_cik)),
      shares,
      valueUsd: resolvePositionValueUsd(shares, row.value_usd_thousands, stockPrice),
      pctOutstanding: pctOfOutstanding(shares, sharesOutstanding),
    });
  }
  return out;
}

export async function fetchCachedQuarterPairMap(
  pool: pg.Pool,
  ticker: string,
  cusips: string[],
  snapshot: OwnershipCacheSnapshot,
  sharesOutstanding: number | null,
  stockPrice: number | null
): Promise<{ current: Map<string, FundHoldingAggregate>; previous: Map<string, FundHoldingAggregate> }> {
  const holders = await fetchCachedTopHolders(
    pool,
    ticker,
    sharesOutstanding,
    stockPrice,
    5000,
    { cusips, quarter: snapshot.currentQuarter }
  );
  const current = new Map(holders.map((h) => [h.fundName, h]));

  if (!snapshot.previousQuarter) {
    return { current, previous: new Map() };
  }

  const ciks = holders.map((h) => h.filerCik).filter((c): c is string => Boolean(c));
  const previous = await fetchPreviousHoldersForCiks(
    pool,
    cusips,
    snapshot.previousQuarter,
    ciks,
    sharesOutstanding,
    stockPrice
  );
  return { current, previous };
}

export async function fetchFilerSharesByCusipQuarter(
  pool: pg.Pool,
  cusips: string[],
  quarter: string,
  sharesOutstanding: number | null = null,
  stockPrice: number | null = null
): Promise<Map<string, FundHoldingAggregate>> {
  const out = new Map<string, FundHoldingAggregate>();
  if (!cusips.length || !quarter) return out;
  const res = await pool.query<{
    filer_cik: string;
    fund_name: string;
    shares: string | number;
    value_usd_thousands?: string | number | null;
  }>(SELECT_FILER_SHARES_BY_CUSIP_QUARTER_SQL, [cusips, quarter]);
  for (const row of res.rows) {
    const filerCik = formatSecCik(String(row.filer_cik));
    const shares = round2(Number(row.shares));
    if (!filerCik || !(shares > 0)) continue;
    out.set(filerCik, {
      fundName: String(row.fund_name || filerCik),
      filerCik,
      shares,
      valueUsd: resolvePositionValueUsd(shares, row.value_usd_thousands, stockPrice),
      pctOutstanding: pctOfOutstanding(shares, sharesOutstanding),
    });
  }
  return out;
}
