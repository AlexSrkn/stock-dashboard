import type pg from "pg";
import { edgarFilingIndexUrl, formatSecCik } from "../sec/http.js";
import {
  getTrackedInstitutionByCik,
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "../ownership/trackedInstitutions.js";
import { resolveHoldingsCiksForProfile, relatedCiksForGroup } from "./filerGroups.js";
import {
  SELECT_FILER_CALLS_FOR_QUARTER_SQL,
  SELECT_FILER_FILINGS_HISTORY_SQL,
  SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL,
  SELECT_FILER_PROFILE_STATS_SQL,
  SELECT_FILER_PUTS_FOR_QUARTER_SQL,
  SELECT_FILER_QUARTERS_SQL,
} from "./queries.js";
import { enrichRowsWithTickers } from "./resolveTicker.js";
import type {
  InstitutionActivityRow,
  InstitutionFilingRow,
  InstitutionHoldingRow,
  InstitutionOptionRow,
  InstitutionProfileMeta,
  InstitutionSummary,
} from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convert a sec_holding value field to USD dollars.
 *
 * Despite the historical `value_usd_thousands` column name, `sec_holding.value`
 * in this database is already stored as USD dollars (see sectorAnalytics:
 * `COALESCE(h.value, h.value_usd_thousands * 1000)` — `h.value` is the dollar path).
 * Do not multiply by 1,000 again.
 */
function filingValueUsd(valueFromDb: number | null | undefined): number | null {
  const x = Number(valueFromDb);
  if (!Number.isFinite(x) || x <= 0) return null;
  return round2(x);
}

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

export function resolveInstitutionCik(cik: string): string | null {
  const digits = String(cik || "").replace(/\D/g, "");
  if (!digits) return null;
  // Allow any well-formed CIK; presence of filings is validated by the query layer.
  return formatSecCik(digits);
}

export function listTrackedInstitutions(): InstitutionSummary[] {
  return TRACKED_INSTITUTIONAL_MANAGERS.map((m) => ({
    name: m.name,
    cik: formatSecCik(m.cik!),
    type: m.type,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function loadFilerQuarters(pool: pg.Pool, ciks: string[], count = 2): Promise<string[]> {
  const res = await pool.query<{ quarter: string }>(SELECT_FILER_QUARTERS_SQL, [ciks, count]);
  return res.rows.map((r) => String(r.quarter));
}

export async function loadInstitutionMeta(
  pool: pg.Pool,
  cik: string
): Promise<InstitutionProfileMeta | null> {
  const { ciks, group } = resolveHoldingsCiksForProfile(cik);
  const manager = getTrackedInstitutionByCik(cik);
  const quarters = await loadFilerQuarters(pool, ciks, 2);
  const stats = await pool.query<{
    filings_count: number;
    latest_filing_date: string | null;
  }>(SELECT_FILER_PROFILE_STATS_SQL, [ciks]);

  const filingsOnRecord = Number(stats.rows[0]?.filings_count ?? 0);
  if (!manager && filingsOnRecord <= 0 && quarters.length === 0) {
    return null;
  }

  let name = manager?.name ?? null;
  let type = manager?.type ?? "hedge_fund";
  if (!name) {
    const nameRes = await pool.query<{ fund_name: string }>(
      `SELECT COALESCE(NULLIF(BTRIM(fund_name), ''), filer_cik) AS fund_name
       FROM sec_filing
       WHERE filer_cik = $1
       ORDER BY
         holdings_count DESC NULLS LAST,
         total_value DESC NULLS LAST,
         filing_date DESC NULLS LAST,
         id DESC
       LIMIT 1`,
      [cik]
    );
    name = nameRes.rows[0]?.fund_name ? String(nameRes.rows[0].fund_name) : null;
    if (!name) return null;
    const { inferInstitutionalManagerType } = await import(
      "../ownership/classifyInstitutionalManager.js"
    );
    type = inferInstitutionalManagerType(name);
  }

  const currentQuarter = quarters[0] ?? null;
  const previousQuarter = quarters[1] ?? null;

  let positionCount = 0;
  let portfolioValueUsd: number | null = null;

  if (currentQuarter) {
    const holdings = await pool.query<{ cusip: string; value_usd_thousands: number }>(
      SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL,
      [ciks, currentQuarter, 5000]
    );
    positionCount = holdings.rows.length;
    const totalK = holdings.rows.reduce(
      (s, r) => s + (Number(r.value_usd_thousands) || 0),
      0
    );
    portfolioValueUsd = filingValueUsd(totalK);
  }

  const row = stats.rows[0];
  return {
    name,
    cik,
    type,
    currentQuarter,
    previousQuarter,
    latestFilingDate: row?.latest_filing_date ?? null,
    positionCount,
    portfolioValueUsd,
    filingsOnRecord,
    relatedCiks: relatedCiksForGroup(group),
    filerGroupId: group?.id ?? null,
    filerGroupNote: group?.note ?? null,
  };
}

export async function getInstitutionHoldings(
  pool: pg.Pool,
  cik: string,
  limit = 50
): Promise<{ meta: InstitutionProfileMeta; holdings: InstitutionHoldingRow[] } | null> {
  const meta = await loadInstitutionMeta(pool, cik);
  if (!meta?.currentQuarter) return meta ? { meta, holdings: [] } : null;

  const { ciks } = resolveHoldingsCiksForProfile(cik);
  const res = await pool.query<{
    cusip: string;
    ticker: string | null;
    issuer: string;
    shares: number;
    value_usd_thousands: number;
  }>(SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL, [ciks, meta.currentQuarter, limit]);

  const totalK = res.rows.reduce((s, r) => s + (Number(r.value_usd_thousands) || 0), 0);
  const totalUsd = filingValueUsd(totalK) ?? 0;

  const holdingsRaw: InstitutionHoldingRow[] = res.rows.map((r) => {
    const valueUsd = filingValueUsd(r.value_usd_thousands);
    return {
      cusip: String(r.cusip),
      ticker: r.ticker ? String(r.ticker).toUpperCase() : null,
      issuer: String(r.issuer),
      shares: round2(Number(r.shares)),
      valueUsd,
      pctOfPortfolio:
        valueUsd != null && totalUsd > 0 ? round2((valueUsd / totalUsd) * 100) : null,
    };
  });

  const holdings = await enrichRowsWithTickers(holdingsRaw);

  return { meta, holdings };
}

function resolveValueChangeUsd(
  curVal: number | null,
  prevVal: number | null,
  curShares: number,
  prevShares: number
): number | null {
  return valueAttributableToShareChange(prevShares, curShares, prevVal, curVal);
}

/**
 * Dollar value attributable to the share-count change (excludes pure price drift
 * on the unchanged share base). Uses current quarter-end implied price when
 * available, otherwise the prior quarter-end price.
 */
export function valueAttributableToShareChange(
  priorShares: number,
  currentShares: number,
  priorValueUsd: number | null,
  currentValueUsd: number | null
): number | null {
  const prior = Number(priorShares) || 0;
  const current = Number(currentShares) || 0;
  const delta = current - prior;
  if (delta === 0) return 0;

  if (prior === 0 && current > 0) {
    return currentValueUsd != null && Number.isFinite(currentValueUsd) ? round2(currentValueUsd) : null;
  }
  if (current === 0 && prior > 0) {
    return priorValueUsd != null && Number.isFinite(priorValueUsd) ? round2(-priorValueUsd) : null;
  }

  const curPrice =
    current > 0 && currentValueUsd != null && Number.isFinite(currentValueUsd) && currentValueUsd > 0
      ? currentValueUsd / current
      : null;
  const prevPrice =
    prior > 0 && priorValueUsd != null && Number.isFinite(priorValueUsd) && priorValueUsd > 0
      ? priorValueUsd / prior
      : null;
  const price = curPrice ?? prevPrice;
  if (price == null || !Number.isFinite(price)) return null;
  return round2(delta * price);
}

export type InstitutionActivityKind = "add" | "trim" | "new" | "closed" | "unchanged";

/** Classify a QoQ position change from share counts only (never from market-value delta). */
export function classifyInstitutionActivity(
  priorShares: number,
  currentShares: number
): InstitutionActivityKind {
  const prior = Number(priorShares) || 0;
  const current = Number(currentShares) || 0;
  if (prior === 0 && current > 0) return "new";
  if (prior > 0 && current === 0) return "closed";
  if (prior > 0 && current > prior) return "add";
  if (prior > 0 && current > 0 && current < prior) return "trim";
  return "unchanged";
}

export function partitionInstitutionActivity(rows: InstitutionActivityRow[]): {
  adds: InstitutionActivityRow[];
  trims: InstitutionActivityRow[];
  newPositions: InstitutionActivityRow[];
  completelySold: InstitutionActivityRow[];
  activity: InstitutionActivityRow[];
} {
  const adds: InstitutionActivityRow[] = [];
  const trims: InstitutionActivityRow[] = [];
  const newPositions: InstitutionActivityRow[] = [];
  const completelySold: InstitutionActivityRow[] = [];

  for (const row of rows) {
    const kind = classifyInstitutionActivity(row.previousShares, row.currentShares);
    if (kind === "add") adds.push(row);
    else if (kind === "trim") trims.push(row);
    else if (kind === "new") newPositions.push(row);
    else if (kind === "closed") completelySold.push(row);
  }

  adds.sort((a, b) => (b.valueChangeUsd ?? 0) - (a.valueChangeUsd ?? 0));
  trims.sort((a, b) => Math.abs(b.valueChangeUsd ?? 0) - Math.abs(a.valueChangeUsd ?? 0));
  newPositions.sort((a, b) => (b.currentValueUsd ?? 0) - (a.currentValueUsd ?? 0));
  completelySold.sort((a, b) => (b.previousValueUsd ?? 0) - (a.previousValueUsd ?? 0));

  const activity = [...rows]
    .filter((r) => classifyInstitutionActivity(r.previousShares, r.currentShares) !== "unchanged")
    .sort((a, b) => Math.abs(b.sharesChange) - Math.abs(a.sharesChange));

  return { adds, trims, newPositions, completelySold, activity };
}

export async function getInstitutionActivity(
  pool: pg.Pool,
  cik: string,
  limit = 50
): Promise<{
  meta: InstitutionProfileMeta;
  activity: InstitutionActivityRow[];
  adds: InstitutionActivityRow[];
  trims: InstitutionActivityRow[];
  newPositions: InstitutionActivityRow[];
  completelySold: InstitutionActivityRow[];
  previousPortfolioValueUsd: number | null;
} | null> {
  const meta = await loadInstitutionMeta(pool, cik);
  if (!meta?.currentQuarter || !meta.previousQuarter) {
    return meta
      ? {
          meta,
          activity: [],
          adds: [],
          trims: [],
          newPositions: [],
          completelySold: [],
          previousPortfolioValueUsd: null,
        }
      : null;
  }

  const { ciks } = resolveHoldingsCiksForProfile(cik);
  const [curRes, prevRes] = await Promise.all([
    pool.query<{
      cusip: string;
      ticker: string | null;
      issuer: string;
      shares: number;
      value_usd_thousands: number;
    }>(SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL, [ciks, meta.currentQuarter, 5000]),
    pool.query<{
      cusip: string;
      ticker: string | null;
      issuer: string;
      shares: number;
      value_usd_thousands: number;
    }>(SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL, [ciks, meta.previousQuarter, 5000]),
  ]);

  const prevMap = new Map(
    prevRes.rows.map((r) => [
      String(r.cusip),
      {
        shares: Number(r.shares),
        valueUsd: filingValueUsd(r.value_usd_thousands),
        ticker: r.ticker,
        issuer: r.issuer,
      },
    ])
  );

  const activity: InstitutionActivityRow[] = [];
  for (const cur of curRes.rows) {
    const cusip = String(cur.cusip);
    const prev = prevMap.get(cusip);
    const curShares = Number(cur.shares);
    const prevShares = prev?.shares ?? 0;
    const sc = round2(curShares - prevShares);
    if (sc === 0) continue;

    const curVal = filingValueUsd(cur.value_usd_thousands);
    const prevVal = prev?.valueUsd ?? null;
    activity.push({
      cusip,
      ticker: cur.ticker ? String(cur.ticker).toUpperCase() : prev?.ticker ? String(prev.ticker).toUpperCase() : null,
      issuer: String(cur.issuer || prev?.issuer || ""),
      currentShares: curShares,
      previousShares: prevShares,
      sharesChange: sc,
      sharesChangePct: pctChange(curShares, prevShares),
      currentValueUsd: curVal,
      previousValueUsd: prevVal,
      valueChangeUsd: resolveValueChangeUsd(curVal, prevVal, curShares, prevShares),
    });
  }

  for (const [cusip, prev] of prevMap) {
    if (curRes.rows.some((r) => String(r.cusip) === cusip)) continue;
    const prevShares = prev.shares;
    if (prevShares <= 0) continue;
    const prevVal = prev.valueUsd;
    activity.push({
      cusip,
      ticker: prev.ticker ? String(prev.ticker).toUpperCase() : null,
      issuer: String(prev.issuer),
      currentShares: 0,
      previousShares: prevShares,
      sharesChange: round2(-prevShares),
      sharesChangePct: -100,
      currentValueUsd: null,
      previousValueUsd: prevVal,
      valueChangeUsd: resolveValueChangeUsd(null, prevVal, 0, prevShares),
    });
  }

  const enriched = await enrichRowsWithTickers(activity);

  const prevTotalK = prevRes.rows.reduce((s, r) => s + (Number(r.value_usd_thousands) || 0), 0);
  const previousPortfolioValueUsd = filingValueUsd(prevTotalK);

  const partitioned = partitionInstitutionActivity(enriched);

  return {
    meta,
    activity: partitioned.activity.slice(0, limit),
    adds: partitioned.adds,
    trims: partitioned.trims,
    newPositions: partitioned.newPositions,
    completelySold: partitioned.completelySold,
    previousPortfolioValueUsd,
  };
}

interface FilerOptionDbRow {
  cusip: string;
  ticker: string | null;
  issuer: string;
  shares: number;
  value_usd_thousands: number;
}

function mapFilerOptionRows(
  rows: FilerOptionDbRow[],
  commonByCusip: Map<string, number | null>
): InstitutionOptionRow[] {
  return rows.map((r) => ({
    cusip: String(r.cusip),
    ticker: r.ticker ? String(r.ticker).toUpperCase() : null,
    issuer: String(r.issuer),
    contracts: round2(Number(r.shares)),
    valueUsd: filingValueUsd(r.value_usd_thousands),
    commonValueUsd: commonByCusip.get(String(r.cusip)) ?? null,
  }));
}

export async function getInstitutionOptions(
  pool: pg.Pool,
  cik: string,
  limit = 100
): Promise<{
  meta: InstitutionProfileMeta;
  commonExposureUsd: number;
  calls: InstitutionOptionRow[];
  puts: InstitutionOptionRow[];
} | null> {
  const meta = await loadInstitutionMeta(pool, cik);
  if (!meta?.currentQuarter) {
    return meta ? { meta, commonExposureUsd: 0, calls: [], puts: [] } : null;
  }

  const { ciks } = resolveHoldingsCiksForProfile(cik);
  const cappedLimit = Math.min(200, Math.max(1, limit));

  const [callsRes, putsRes, holdingsRes] = await Promise.all([
    pool.query<FilerOptionDbRow>(SELECT_FILER_CALLS_FOR_QUARTER_SQL, [
      ciks,
      meta.currentQuarter,
      cappedLimit,
    ]),
    pool.query<FilerOptionDbRow>(SELECT_FILER_PUTS_FOR_QUARTER_SQL, [
      ciks,
      meta.currentQuarter,
      cappedLimit,
    ]),
    pool.query<{ cusip: string; value_usd_thousands: number }>(
      SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL,
      [ciks, meta.currentQuarter, 5000]
    ),
  ]);

  const commonByCusip = new Map<string, number | null>();
  let commonExposureUsd = 0;
  for (const row of holdingsRes.rows) {
    const valueUsd = filingValueUsd(row.value_usd_thousands);
    commonByCusip.set(String(row.cusip), valueUsd);
    if (valueUsd != null) commonExposureUsd += valueUsd;
  }
  commonExposureUsd = round2(commonExposureUsd);

  const callsRaw = mapFilerOptionRows(callsRes.rows, commonByCusip);
  const putsRaw = mapFilerOptionRows(putsRes.rows, commonByCusip);
  const calls = await enrichRowsWithTickers(callsRaw);
  const puts = await enrichRowsWithTickers(putsRaw);

  return { meta, commonExposureUsd, calls, puts };
}

function institutionFilingHref(cik: string, accessionNumber: string): string {
  return edgarFilingIndexUrl(cik, accessionNumber);
}

export async function getInstitutionHistory(
  pool: pg.Pool,
  cik: string,
  limit = 20
): Promise<{ meta: InstitutionProfileMeta; filings: InstitutionFilingRow[] } | null> {
  const meta = await loadInstitutionMeta(pool, cik);
  if (!meta) return null;

  const res = await pool.query<{
    accession_number: string;
    form_type: string;
    filing_date: string;
    report_period: string | null;
    quarter: string;
    holdings_count: number;
    total_value: number | null;
    info_table_document: string | null;
  }>(SELECT_FILER_FILINGS_HISTORY_SQL, [cik, limit]);

  const filings: InstitutionFilingRow[] = res.rows.map((r) => ({
    accessionNumber: String(r.accession_number),
    formType: String(r.form_type),
    filingDate: String(r.filing_date),
    reportPeriod: r.report_period,
    quarter: String(r.quarter),
    holdingsCount: Number(r.holdings_count),
    totalValueUsd:
      r.total_value != null && Number.isFinite(Number(r.total_value))
        ? Number(r.total_value)
        : null,
    href: institutionFilingHref(cik, String(r.accession_number)),
  }));

  return { meta, filings };
}
