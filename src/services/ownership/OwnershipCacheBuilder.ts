/**
 * Builds the ownership cache (one row per ticker) from raw 13F holdings + the
 * latest fundamentals shares-outstanding. This is the heavy step — it runs once
 * during ingestion, never on a screener request.
 *
 * Produces:
 *   - ownership_cache   : per-ticker aggregate signals (% owned, trend, count, top holders, types)
 *   - ownership_holding : per ticker x institution rows (for fast "Held by" lookups)
 */
import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import { sortQuarters } from "../../institution/performance/quarters.js";
import { formatSecCik } from "../../sec/http.js";
import {
  buildSeedDirectoryMap,
  ensureOwnershipSchema,
  type InstitutionRecord,
  type InstitutionType,
} from "./InstitutionDirectory.js";
import { INSTITUTIONAL_13F_MANAGERS } from "../../sec/seed/institutional-ciks.js";
import { normalizeCusip } from "../../sec/thirteenF/normalizeHoldings.js";

const TREND_EPS = 0.005; // ±0.5% change band counts as neutral
const TOP_INSTITUTIONS = 10;
const INSERT_CHUNK = 200;

export type OwnershipTrend = "increasing" | "decreasing" | "neutral";

export interface TopInstitution {
  cik: string;
  name: string;
  type: InstitutionType;
  shares: number;
  ownershipPercent: number | null;
}

export interface OwnershipCacheRow {
  ticker: string;
  institutionalOwnershipPct: number | null;
  insiderOwnershipPct: number | null;
  ownershipTrend: OwnershipTrend;
  institutionCount: number;
  currentShares: number;
  previousShares: number;
  sharesOutstanding: number | null;
  topInstitutions: TopInstitution[];
  /** All current-quarter holders (persisted to ownership_holding for "Held by" lookups). */
  allHolders: TopInstitution[];
  institutionTypes: InstitutionType[];
  currentQuarter: string;
  primaryCusip: string | null;
}

export interface OwnershipBuildResult {
  tickers: number;
  holdings: number;
  currentQuarter: string;
  previousQuarter: string | null;
  durationMs: number;
}

interface HolderAgg {
  cik: string;
  currentShares: number;
}

interface TickerAgg {
  ticker: string;
  currentShares: number;
  previousShares: number;
  holders: Map<string, HolderAgg>; // current-quarter holders by cik
  cusipShares: Map<string, number>;
}

function computeTrend(current: number, previous: number): OwnershipTrend {
  if (previous <= 0) return current > 0 ? "increasing" : "neutral";
  if (current > previous * (1 + TREND_EPS)) return "increasing";
  if (current < previous * (1 - TREND_EPS)) return "decreasing";
  return "neutral";
}

async function loadSharesOutstanding(pool: pg.Pool): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const res = await pool.query<{ ticker: string; so: number | string | null }>(
    `SELECT DISTINCT ON (UPPER(BTRIM(ticker)))
       UPPER(BTRIM(ticker)) AS ticker,
       (metrics->>'shares_outstanding')::float8 AS so
     FROM sec_financial_period
     WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''
       AND metrics ? 'shares_outstanding'
     ORDER BY UPPER(BTRIM(ticker)), period_end DESC, filed_date DESC`
  );
  for (const row of res.rows) {
    const so = Number(row.so);
    if (Number.isFinite(so) && so > 0) map.set(row.ticker, so);
  }
  return map;
}

async function chunkedInsert(
  pool: pg.Pool,
  baseSql: string,
  columnsPerRow: number,
  rows: unknown[][]
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const valuesSql = chunk
      .map((_, r) => {
        const base = r * columnsPerRow;
        const placeholders = Array.from({ length: columnsPerRow }, (_, c) => `$${base + c + 1}`);
        return `(${placeholders.join(", ")})`;
      })
      .join(", ");
    await pool.query(`${baseSql} VALUES ${valuesSql}`, chunk.flat());
  }
}

export function computeOwnershipRows(
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>,
  directory: Map<string, InstitutionRecord>,
  sharesOutstanding: Map<string, number>
): { rows: OwnershipCacheRow[]; currentQuarter: string; previousQuarter: string | null } {
  const quarters = sortQuarters([...new Set(holdings.map((h) => h.quarter))]);
  const currentQuarter = quarters[quarters.length - 1] ?? "";
  const previousQuarter = quarters.length >= 2 ? quarters[quarters.length - 2] : null;

  const byTicker = new Map<string, TickerAgg>();
  const ensure = (ticker: string): TickerAgg => {
    let agg = byTicker.get(ticker);
    if (!agg) {
      agg = { ticker, currentShares: 0, previousShares: 0, holders: new Map(), cusipShares: new Map() };
      byTicker.set(ticker, agg);
    }
    return agg;
  };

  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares) || h.shares <= 0) continue;
    const agg = ensure(h.ticker);
    const cik = formatSecCik(h.institutionId);
    if (h.quarter === currentQuarter) {
      agg.currentShares += h.shares;
      const holder = agg.holders.get(cik) ?? { cik, currentShares: 0 };
      holder.currentShares += h.shares;
      agg.holders.set(cik, holder);
      if (h.cusip) {
        const cusip = normalizeCusip(String(h.cusip).trim());
        if (cusip) {
          agg.cusipShares.set(cusip, (agg.cusipShares.get(cusip) ?? 0) + h.shares);
        }
      }
    } else if (previousQuarter && h.quarter === previousQuarter) {
      agg.previousShares += h.shares;
    }
  }

  const rows: OwnershipCacheRow[] = [];
  for (const agg of byTicker.values()) {
    const so = sharesOutstanding.get(agg.ticker) ?? null;
    const instPct = so && so > 0 ? (agg.currentShares / so) * 100 : null;

    const holders = [...agg.holders.values()].sort((a, b) => b.currentShares - a.currentShares);
    const types = new Set<InstitutionType>();
    const allHolders: TopInstitution[] = holders.map((holder) => {
      const rec = directory.get(holder.cik);
      const type = rec?.type ?? "Other";
      types.add(type);
      return {
        cik: holder.cik,
        name: rec?.name ?? holder.cik,
        type,
        shares: Math.round(holder.currentShares),
        ownershipPercent: so && so > 0 ? Math.round((holder.currentShares / so) * 10000) / 100 : null,
      };
    });

    rows.push({
      ticker: agg.ticker,
      institutionalOwnershipPct: instPct != null ? Math.round(instPct * 100) / 100 : null,
      insiderOwnershipPct: null, // requires Form 4 post-transaction holdings (not yet ingested)
      ownershipTrend: computeTrend(agg.currentShares, agg.previousShares),
      institutionCount: agg.holders.size,
      currentShares: Math.round(agg.currentShares),
      previousShares: Math.round(agg.previousShares),
      sharesOutstanding: so,
      topInstitutions: allHolders.slice(0, TOP_INSTITUTIONS),
      allHolders,
      institutionTypes: [...types],
      currentQuarter,
      primaryCusip: pickPrimaryCusip(agg.cusipShares),
    });
  }

  return { rows, currentQuarter, previousQuarter };
}

function pickPrimaryCusip(cusipShares: Map<string, number>): string | null {
  let best: string | null = null;
  let bestShares = 0;
  for (const [cusip, shares] of cusipShares) {
    if (shares > bestShares) {
      bestShares = shares;
      best = cusip;
    }
  }
  return best;
}

export async function buildOwnershipCache(pool: pg.Pool = getPool()): Promise<OwnershipBuildResult> {
  const t0 = Date.now();
  await ensureOwnershipSchema(pool);

  // Name/type lookup from directory; holdings aggregation uses the curated seed CIKs only.
  // After a bulk sync TRACKED_* can be thousands of filers — loading all of them here OOMs.
  const directory = buildSeedDirectoryMap();
  const dirRes = await pool.query<{
    cik: string;
    name: string;
    normalized_name: string;
    type: InstitutionType;
  }>(`SELECT cik, name, normalized_name, type FROM institution`);
  for (const r of dirRes.rows) {
    const cik = formatSecCik(r.cik);
    if (!directory.has(cik)) continue;
    directory.set(cik, {
      cik,
      name: r.name,
      normalizedName: r.normalized_name,
      type: r.type,
    });
  }

  const curatedCiks = INSTITUTIONAL_13F_MANAGERS.filter((m) => m.cik).map((m) =>
    formatSecCik(m.cik as string)
  );

  // Use one dedicated connection with no statement timeout: the raw 13F holdings
  // aggregation is intentionally heavy (hundreds of thousands of rows).
  const client = await pool.connect();
  let holdingRowCount = 0;
  let rows: OwnershipCacheRow[] = [];
  let currentQuarter = "";
  let previousQuarter: string | null = null;
  try {
    await client.query("SET statement_timeout = 0");

    const clientAsPool = client as unknown as pg.Pool;
    const holdings = await loadInstitutionHoldings(clientAsPool, curatedCiks);
    const sharesOutstanding = await loadSharesOutstanding(clientAsPool);

    const computed = computeOwnershipRows(holdings, directory, sharesOutstanding);
    rows = computed.rows;
    currentQuarter = computed.currentQuarter;
    previousQuarter = computed.previousQuarter;

    await client.query("BEGIN");
    await client.query("TRUNCATE ownership_cache");
    await client.query("TRUNCATE ownership_holding");

    const cacheRows: unknown[][] = rows.map((r) => [
      r.ticker,
      r.institutionalOwnershipPct,
      r.insiderOwnershipPct,
      r.ownershipTrend,
      r.institutionCount,
      r.currentShares,
      r.previousShares,
      r.sharesOutstanding,
      JSON.stringify(r.topInstitutions),
      r.institutionTypes,
      r.currentQuarter,
      r.primaryCusip,
    ]);
    await chunkedInsert(
      client as unknown as pg.Pool,
      `INSERT INTO ownership_cache
        (ticker, institutional_ownership_pct, insider_ownership_pct, ownership_trend,
         institution_count, current_shares, previous_shares, shares_outstanding,
         top_institutions, institution_types, current_quarter, primary_cusip)`,
      12,
      cacheRows
    );

    const holdingRows: unknown[][] = [];
    for (const r of rows) {
      for (const holder of r.allHolders) {
        holdingRows.push([r.ticker, holder.cik, holder.name, holder.type, holder.shares, holder.ownershipPercent]);
      }
    }
    holdingRowCount = holdingRows.length;
    await chunkedInsert(
      client as unknown as pg.Pool,
      `INSERT INTO ownership_holding
        (ticker, institution_cik, institution_name, institution_type, shares, ownership_pct)`,
      6,
      holdingRows
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    tickers: rows.length,
    holdings: holdingRowCount,
    currentQuarter,
    previousQuarter,
    durationMs: Date.now() - t0,
  };
}
