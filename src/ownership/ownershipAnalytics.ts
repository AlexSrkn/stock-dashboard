import type pg from "pg";
import type {
  FundHoldingAggregate,
  InstitutionalChartEventRow,
  InstitutionalChartEventsResponse,
  InstitutionalOptionsResponse,
  OptionPositionRow,
  OwnershipChangeRow,
  OwnershipQueryMeta,
  OwnershipQueryOptions,
  PositionEventRow,
} from "./types.js";
import {
  SELECT_RECENT_QUARTERS_FOR_CUSIPS_SQL,
  SELECT_FILERS_WITH_QUARTER_FILING_SQL,
  SELECT_TRACKED_AGGREGATES_BY_FILER_FOR_QUARTERS_SQL,
  SELECT_TRACKED_AGGREGATES_BY_FILER_SQL,
  SELECT_TRACKED_CALLS_BY_FILER_SQL,
  SELECT_TRACKED_FILER_QUARTER_FILING_DATES_SQL,
  SELECT_TRACKED_HOLDINGS_BY_QUARTER_SQL,
  SELECT_TRACKED_PUTS_BY_FILER_SQL,
} from "./queries.js";
import { resolveStockIdentifiers } from "./resolveStock.js";
import {
  loadOwnershipCacheSnapshot,
} from "./ownershipCacheReader.js";
import {
  canonicalFundName,
  reloadTrackedInstitutions,
  TRACKED_INSTITUTIONAL_CIK_PADDED,
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "./trackedInstitutions.js";
import { formatSecCik } from "../sec/http.js";
import { fetchStockPrice } from "../market/stockPrice.js";
import { valueAttributableToShareChange } from "../institution/institutionAnalytics.js";
import { filingValueUsd, resolvePositionValueUsd } from "./holdingValue.js";

interface FundAggRow {
  fund_name: string;
  shares: number;
  value_usd_thousands: number;
}

interface TrackedFundAggRow extends FundAggRow {
  filer_cik: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

function pctOfOutstanding(shares: number, sharesOutstanding: number | null): number | null {
  if (!sharesOutstanding || sharesOutstanding <= 0) return null;
  return round2((shares / sharesOutstanding) * 100);
}

function mapOptionRows(
  rows: TrackedFundAggRow[],
  nameForRow: (row: TrackedFundAggRow) => string
): OptionPositionRow[] {
  return rows.map((r) => ({
    fundName: nameForRow(r),
    contracts: round2(Number(r.shares)),
    valueUsd: filingValueUsd(r.value_usd_thousands),
  }));
}

function withHolderMetrics(
  rows: FundAggRow[],
  sharesOutstanding: number | null,
  stockPrice: number | null,
  nameForRow: (row: FundAggRow) => string = (r) => String(r.fund_name)
): FundHoldingAggregate[] {
  return rows.map((r) => {
    const shares = round2(Number(r.shares));
    const row: FundHoldingAggregate = {
      fundName: nameForRow(r),
      shares,
      valueUsd: resolvePositionValueUsd(shares, r.value_usd_thousands, stockPrice),
      pctOutstanding: pctOfOutstanding(shares, sharesOutstanding),
    };
    if ("filer_cik" in r && r.filer_cik) {
      row.filerCik = formatSecCik(String(r.filer_cik));
    }
    return row;
  });
}

function sortByValueDesc(holders: FundHoldingAggregate[]): FundHoldingAggregate[] {
  return [...holders].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

const QUARTER_PAIR_TTL_MS = 60_000;
const quarterPairCache = new Map<
  string,
  {
    expiresAt: number;
    value: { current: Map<string, FundHoldingAggregate>; previous: Map<string, FundHoldingAggregate> };
  }
>();
const quarterPairInflight = new Map<
  string,
  Promise<{ current: Map<string, FundHoldingAggregate>; previous: Map<string, FundHoldingAggregate> }>
>();

function holderByCikMap(holders: Iterable<FundHoldingAggregate>): Map<string, FundHoldingAggregate> {
  const out = new Map<string, FundHoldingAggregate>();
  for (const h of holders) {
    if (h.filerCik) out.set(formatSecCik(h.filerCik), h);
  }
  return out;
}

function matchHolder(
  holder: FundHoldingAggregate,
  byName: Map<string, FundHoldingAggregate>,
  byCik: Map<string, FundHoldingAggregate>
): FundHoldingAggregate | undefined {
  return (holder.filerCik ? byCik.get(formatSecCik(holder.filerCik)) : undefined) ?? byName.get(holder.fundName);
}

function attachQuarterOverQuarterChange(
  holders: FundHoldingAggregate[],
  previous: Map<string, FundHoldingAggregate>
): FundHoldingAggregate[] {
  const prevByCik = holderByCikMap(previous.values());
  return holders.map((h) => {
    const prev = matchHolder(h, previous, prevByCik);
    const previousShares = prev?.shares ?? null;
    const sharesChangePct =
      prev != null && Number.isFinite(prev.shares) && prev.shares > 0
        ? pctChange(h.shares, prev.shares)
        : null;
    const valueChangeUsd = valueAttributableToShareChange(
      prev?.shares ?? 0,
      h.shares,
      prev?.valueUsd ?? null,
      h.valueUsd
    );
    return { ...h, previousShares, sharesChangePct, valueChangeUsd };
  });
}

function trackedDisplayName(row: TrackedFundAggRow): string {
  return canonicalFundName(String(row.filer_cik), String(row.fund_name));
}

export async function loadOwnershipMeta(
  pool: pg.Pool,
  ticker: string
): Promise<OwnershipQueryMeta> {
  reloadTrackedInstitutions();
  const stock = await resolveStockIdentifiers(pool, ticker);
  const cacheSnapshot = await loadOwnershipCacheSnapshot(pool, stock.ticker);
  const [quarters, quote] = await Promise.all([
    cacheSnapshot?.currentQuarter
      ? Promise.resolve([cacheSnapshot.currentQuarter, cacheSnapshot.previousQuarter].filter(Boolean) as string[])
      : loadRecentQuarters(pool, stock.cusips, 2),
    fetchStockPrice(stock.ticker),
  ]);
  const sharesOutstanding = cacheSnapshot?.sharesOutstanding ?? null;
  return {
    ticker: stock.ticker,
    cusips: stock.cusips,
    issuerHint: stock.issuerHint,
    currentQuarter: cacheSnapshot?.currentQuarter ?? quarters[0] ?? "",
    previousQuarter: cacheSnapshot?.previousQuarter ?? quarters[1] ?? null,
    trackedFundCount: TRACKED_INSTITUTIONAL_MANAGERS.length,
    impliedSharesOutstanding: sharesOutstanding,
    stockPrice: quote.price,
    currency: quote.currency,
  };
}

export async function loadRecentQuarters(
  pool: pg.Pool,
  cusips: string[],
  count: number
): Promise<string[]> {
  const res = await pool.query<{ quarter: string }>(SELECT_RECENT_QUARTERS_FOR_CUSIPS_SQL, [
    cusips,
    count,
  ]);
  return res.rows.map((r) => String(r.quarter));
}

export async function fetchTrackedAggregatesForQuarter(
  pool: pg.Pool,
  cusips: string[],
  quarter: string,
  sharesOutstanding: number | null,
  stockPrice: number | null,
  limit = 500
): Promise<FundHoldingAggregate[]> {
  // NULL CIK filter → every filer in sec_holding for this CUSIP (full bulk ingest).
  const res = await pool.query<TrackedFundAggRow>(SELECT_TRACKED_AGGREGATES_BY_FILER_SQL, [
    cusips,
    quarter,
    null,
    limit,
  ]);
  return sortByValueDesc(
    withHolderMetrics(res.rows, sharesOutstanding, stockPrice, trackedDisplayName)
  );
}

export async function fetchQuarterPairMap(
  pool: pg.Pool,
  cusips: string[],
  currentQuarter: string,
  previousQuarter: string | null,
  sharesOutstanding: number | null,
  stockPrice: number | null,
  ticker?: string,
  _options: { skipCache?: boolean } = {}
): Promise<{ current: Map<string, FundHoldingAggregate>; previous: Map<string, FundHoldingAggregate> }> {
  const cacheKey = [
    ticker || "",
    cusips.join(","),
    currentQuarter,
    previousQuarter || "",
    sharesOutstanding ?? "",
    stockPrice ?? "",
  ].join("|");
  const hit = quarterPairCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (quarterPairInflight.has(cacheKey)) return quarterPairInflight.get(cacheKey)!;

  const run = (async () => {
    const quarters = previousQuarter ? [currentQuarter, previousQuarter] : [currentQuarter];
    const res = await pool.query<TrackedFundAggRow & { quarter: string }>(
      SELECT_TRACKED_AGGREGATES_BY_FILER_FOR_QUARTERS_SQL,
      [cusips, quarters, null]
    );

    const byQ = new Map<string, TrackedFundAggRow[]>();
    for (const row of res.rows) {
      const q = String(row.quarter);
      const list = byQ.get(q) ?? [];
      list.push(row);
      byQ.set(q, list);
    }

    const current = new Map(
      withHolderMetrics(
        byQ.get(currentQuarter) ?? [],
        sharesOutstanding,
        stockPrice,
        trackedDisplayName
      ).map((h) => [h.fundName, h])
    );
    const previous = previousQuarter
      ? new Map(
          withHolderMetrics(
            byQ.get(previousQuarter) ?? [],
            sharesOutstanding,
            stockPrice,
            trackedDisplayName
          ).map((h) => [h.fundName, h])
        )
      : new Map();

    const value = { current, previous };
    quarterPairCache.set(cacheKey, { expiresAt: Date.now() + QUARTER_PAIR_TTL_MS, value });
    return value;
  })();

  quarterPairInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    quarterPairInflight.delete(cacheKey);
  }
}

export async function getTopHolders(
  pool: pg.Pool,
  ticker: string,
  options: OwnershipQueryOptions = {}
): Promise<{ meta: OwnershipQueryMeta; holders: FundHoldingAggregate[] }> {
  const meta = await loadOwnershipMeta(pool, ticker);
  if (!meta.currentQuarter) {
    return { meta, holders: [] };
  }
  const limit = Math.min(200, Math.max(1, options.limit ?? 100));

  const { current, previous } = await fetchQuarterPairMap(
    pool,
    meta.cusips,
    meta.currentQuarter,
    meta.previousQuarter,
    meta.impliedSharesOutstanding,
    meta.stockPrice,
    meta.ticker
  );

  let holders = sortByValueDesc([...current.values()]).slice(0, limit);
  if (meta.previousQuarter) {
    holders = attachQuarterOverQuarterChange(holders, previous);
  }

  return { meta, holders };
}

export async function getOwnershipChanges(
  pool: pg.Pool,
  ticker: string,
  options: OwnershipQueryOptions = {}
): Promise<{ meta: OwnershipQueryMeta; changes: OwnershipChangeRow[] }> {
  const meta = await loadOwnershipMeta(pool, ticker);
  if (!meta.currentQuarter || !meta.previousQuarter) {
    return { meta, changes: [] };
  }

  const { current, previous } = await fetchQuarterPairMap(
    pool,
    meta.cusips,
    meta.currentQuarter,
    meta.previousQuarter,
    meta.impliedSharesOutstanding,
    meta.stockPrice,
    meta.ticker
  );

  const changes: OwnershipChangeRow[] = [];
  const prevByCik = holderByCikMap(previous.values());
  for (const [fundName, cur] of current) {
    const prev = matchHolder(cur, previous, prevByCik);
    if (!prev) continue;
    changes.push({
      fundName,
      filerCik: cur.filerCik,
      currentShares: cur.shares,
      currentValueUsd: cur.valueUsd,
      previousShares: prev.shares,
      previousValueUsd: prev.valueUsd,
      sharesChange: round2(cur.shares - prev.shares),
      valueChangeUsd: valueAttributableToShareChange(
        prev.shares,
        cur.shares,
        prev.valueUsd,
        cur.valueUsd
      ),
      sharesChangePct: pctChange(cur.shares, prev.shares),
      currentPctOutstanding: cur.pctOutstanding,
      previousPctOutstanding: prev.pctOutstanding,
    });
  }

  changes.sort((a, b) => Math.abs(b.valueChangeUsd ?? 0) - Math.abs(a.valueChangeUsd ?? 0));
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  return { meta, changes: changes.slice(0, limit) };
}

export async function getNewPositions(
  pool: pg.Pool,
  ticker: string,
  options: OwnershipQueryOptions = {}
): Promise<{ meta: OwnershipQueryMeta; positions: PositionEventRow[] }> {
  const meta = await loadOwnershipMeta(pool, ticker);
  if (!meta.currentQuarter) {
    return { meta, positions: [] };
  }

  const { current, previous } = await fetchQuarterPairMap(
    pool,
    meta.cusips,
    meta.currentQuarter,
    meta.previousQuarter,
    meta.impliedSharesOutstanding,
    meta.stockPrice,
    meta.ticker
  );

  const positions: PositionEventRow[] = [];
  const prevByCik = holderByCikMap(previous.values());
  for (const [fundName, cur] of current) {
    const prev = matchHolder(cur, previous, prevByCik);
    if (!prev || prev.shares <= 0) {
      positions.push({
        fundName,
        filerCik: cur.filerCik,
        shares: cur.shares,
        valueUsd: cur.valueUsd,
        pctOutstanding: cur.pctOutstanding,
        previousShares: prev?.shares ?? 0,
        previousValueUsd: prev?.valueUsd ?? null,
      });
    }
  }

  positions.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  return { meta, positions: positions.slice(0, limit) };
}

export async function getSoldOut(
  pool: pg.Pool,
  ticker: string,
  options: OwnershipQueryOptions = {}
): Promise<{ meta: OwnershipQueryMeta; positions: PositionEventRow[] }> {
  const meta = await loadOwnershipMeta(pool, ticker);
  if (!meta.currentQuarter || !meta.previousQuarter) {
    return { meta, positions: [] };
  }

  // Compare all filers for both quarters by CIK (full sec_holding universe).
  const { current, previous } = await fetchQuarterPairMap(
    pool,
    meta.cusips,
    meta.currentQuarter,
    meta.previousQuarter,
    meta.impliedSharesOutstanding,
    meta.stockPrice,
    meta.ticker
  );
  const previousCiks = [
    ...new Set(
      [...previous.values()]
        .map((h) => (h.filerCik ? formatSecCik(h.filerCik) : ""))
        .filter(Boolean)
    ),
  ];
  if (!previousCiks.length) {
    return { meta, positions: [] };
  }

  // Only count exits for filers that already submitted a current-quarter 13F.
  // Missing Q2 filings must not be treated as sold-out.
  const filedRes = await pool.query<{ filer_cik: string }>(SELECT_FILERS_WITH_QUARTER_FILING_SQL, [
    meta.currentQuarter,
    previousCiks,
  ]);
  const filedCurrent = new Set(filedRes.rows.map((r) => formatSecCik(String(r.filer_cik))));

  const currentByCik = new Map<string, FundHoldingAggregate>();
  for (const h of current.values()) {
    if (!h.filerCik) continue;
    currentByCik.set(formatSecCik(h.filerCik), h);
  }

  const positions: PositionEventRow[] = [];
  for (const prev of previous.values()) {
    if (!prev.filerCik || prev.shares <= 0) continue;
    const cik = formatSecCik(prev.filerCik);
    if (!filedCurrent.has(cik)) continue;
    const cur = currentByCik.get(cik);
    if (cur && cur.shares > 0) continue;
    positions.push({
      fundName: prev.fundName,
      filerCik: prev.filerCik,
      shares: cur?.shares ?? 0,
      valueUsd: cur?.valueUsd ?? null,
      pctOutstanding: cur?.pctOutstanding ?? null,
      previousShares: prev.shares,
      previousValueUsd: prev.valueUsd,
    });
  }

  positions.sort((a, b) => (b.previousValueUsd ?? 0) - (a.previousValueUsd ?? 0));
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  return { meta, positions: positions.slice(0, limit) };
}

async function fetchTrackedOptionsForQuarter(
  pool: pg.Pool,
  cusips: string[],
  quarter: string,
  sql: string,
  limit: number
): Promise<OptionPositionRow[]> {
  const res = await pool.query<TrackedFundAggRow>(sql, [
    cusips,
    quarter,
    [...TRACKED_INSTITUTIONAL_CIK_PADDED],
    limit,
  ]);
  return mapOptionRows(res.rows, trackedDisplayName).sort(
    (a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)
  );
}

export async function getInstitutionalOptions(
  pool: pg.Pool,
  ticker: string,
  options: OwnershipQueryOptions = {}
): Promise<InstitutionalOptionsResponse> {
  const meta = await loadOwnershipMeta(pool, ticker);
  if (!meta.currentQuarter) {
    return { meta, calls: [], puts: [] };
  }
  const limit = Math.min(200, Math.max(1, options.limit ?? 100));
  const [calls, puts] = await Promise.all([
    fetchTrackedOptionsForQuarter(
      pool,
      meta.cusips,
      meta.currentQuarter,
      SELECT_TRACKED_CALLS_BY_FILER_SQL,
      limit
    ),
    fetchTrackedOptionsForQuarter(
      pool,
      meta.cusips,
      meta.currentQuarter,
      SELECT_TRACKED_PUTS_BY_FILER_SQL,
      limit
    ),
  ]);
  return { meta, calls, puts };
}

interface QuarterHoldingRow {
  filer_cik: string;
  fund_name: string;
  quarter: string;
  filing_date: string;
  shares: number;
}

export async function getInstitutionalChartEvents(
  pool: pg.Pool,
  ticker: string,
  options: OwnershipQueryOptions = {}
): Promise<InstitutionalChartEventsResponse> {
  const stock = await resolveStockIdentifiers(pool, ticker);
  const quarterCount = Math.min(40, Math.max(2, options.quarters ?? 24));
  const quarters = await loadRecentQuarters(pool, stock.cusips, quarterCount);

  const emptyMeta = {
    ticker: stock.ticker,
    cusips: stock.cusips,
    trackedFundCount: TRACKED_INSTITUTIONAL_MANAGERS.length,
    quartersLoaded: quarters.length,
  };

  if (quarters.length < 2) {
    return { meta: emptyMeta, events: [] };
  }

  const [holdingsRes, filingDatesRes] = await Promise.all([
    pool.query<QuarterHoldingRow>(SELECT_TRACKED_HOLDINGS_BY_QUARTER_SQL, [
      stock.cusips,
      quarters,
      [...TRACKED_INSTITUTIONAL_CIK_PADDED],
    ]),
    pool.query<{ filer_cik: string; quarter: string; filing_date: string }>(
      SELECT_TRACKED_FILER_QUARTER_FILING_DATES_SQL,
      [[...TRACKED_INSTITUTIONAL_CIK_PADDED], quarters]
    ),
  ]);

  const filingDateByKey = new Map<string, string>();
  for (const row of filingDatesRes.rows) {
    filingDateByKey.set(`${row.filer_cik}:${row.quarter}`, String(row.filing_date));
  }

  const byQuarter = new Map<string, Map<string, QuarterHoldingRow>>();
  for (const row of holdingsRes.rows) {
    const q = String(row.quarter);
    let map = byQuarter.get(q);
    if (!map) {
      map = new Map();
      byQuarter.set(q, map);
    }
    map.set(String(row.filer_cik), row);
  }

  const events: InstitutionalChartEventRow[] = [];

  for (let i = 0; i < quarters.length - 1; i++) {
    const curQ = quarters[i];
    const prevQ = quarters[i + 1];
    const cur = byQuarter.get(curQ) ?? new Map();
    const prev = byQuarter.get(prevQ) ?? new Map();
    const filers = new Set([...cur.keys(), ...prev.keys()]);

    for (const filerCik of filers) {
      const curRow = cur.get(filerCik);
      const prevRow = prev.get(filerCik);
      const curShares = round2(Number(curRow?.shares ?? 0));
      const prevShares = round2(Number(prevRow?.shares ?? 0));
      if (curShares === prevShares) continue;

      const filingDate = filingDateByKey.get(`${filerCik}:${curQ}`);
      if (!filingDate) continue;

      const sharesChange = round2(curShares - prevShares);
      const side: "buy" | "sell" = sharesChange > 0 ? "buy" : "sell";
      let eventType: InstitutionalChartEventRow["eventType"];
      if (prevShares <= 0 && curShares > 0) eventType = "new";
      else if (curShares <= 0 && prevShares > 0) eventType = "sold-out";
      else if (sharesChange > 0) eventType = "add";
      else eventType = "trim";

      events.push({
        fundName: canonicalFundName(filerCik, String(curRow?.fund_name || prevRow?.fund_name || "")),
        filerCik: formatSecCik(filerCik),
        quarter: curQ,
        filingDate,
        side,
        sharesChange,
        currentShares: curShares,
        previousShares: prevShares,
        eventType,
      });
    }
  }

  events.sort((a, b) => {
    const da = a.filingDate.localeCompare(b.filingDate);
    if (da !== 0) return da;
    return Math.abs(b.sharesChange) - Math.abs(a.sharesChange);
  });

  const limit = Math.min(500, Math.max(1, options.limit ?? 300));
  return { meta: emptyMeta, events: events.slice(-limit) };
}
