import type pg from "pg";
import { edgarFilingIndexUrl, formatSecCik } from "../sec/http.js";
import {
  getTrackedInstitutionByCik,
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "../ownership/trackedInstitutions.js";
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

function filingValueUsd(valueThousands: number | null | undefined): number | null {
  const x = Number(valueThousands);
  if (!Number.isFinite(x) || x <= 0) return null;
  return round2(x * 1000);
}

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

export function resolveInstitutionCik(cik: string): string | null {
  const padded = formatSecCik(cik);
  return getTrackedInstitutionByCik(padded) ? padded : null;
}

export function listTrackedInstitutions(): InstitutionSummary[] {
  return TRACKED_INSTITUTIONAL_MANAGERS.map((m) => ({
    name: m.name,
    cik: formatSecCik(m.cik!),
    type: m.type,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function loadFilerQuarters(pool: pg.Pool, cik: string, count = 2): Promise<string[]> {
  const res = await pool.query<{ quarter: string }>(SELECT_FILER_QUARTERS_SQL, [cik, count]);
  return res.rows.map((r) => String(r.quarter));
}

export async function loadInstitutionMeta(
  pool: pg.Pool,
  cik: string
): Promise<InstitutionProfileMeta | null> {
  const manager = getTrackedInstitutionByCik(cik);
  if (!manager) return null;

  const quarters = await loadFilerQuarters(pool, cik, 2);
  const stats = await pool.query<{
    filings_count: number;
    latest_filing_date: string | null;
  }>(SELECT_FILER_PROFILE_STATS_SQL, [cik]);

  const currentQuarter = quarters[0] ?? null;
  const previousQuarter = quarters[1] ?? null;

  let positionCount = 0;
  let portfolioValueUsd: number | null = null;

  if (currentQuarter) {
    const holdings = await pool.query<{ cusip: string; value_usd_thousands: number }>(
      SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL,
      [cik, currentQuarter, 5000]
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
    name: manager.name,
    cik,
    type: manager.type,
    currentQuarter,
    previousQuarter,
    latestFilingDate: row?.latest_filing_date ?? null,
    positionCount,
    portfolioValueUsd,
    filingsOnRecord: Number(row?.filings_count ?? 0),
  };
}

export async function getInstitutionHoldings(
  pool: pg.Pool,
  cik: string,
  limit = 50
): Promise<{ meta: InstitutionProfileMeta; holdings: InstitutionHoldingRow[] } | null> {
  const meta = await loadInstitutionMeta(pool, cik);
  if (!meta?.currentQuarter) return meta ? { meta, holdings: [] } : null;

  const res = await pool.query<{
    cusip: string;
    ticker: string | null;
    issuer: string;
    shares: number;
    value_usd_thousands: number;
  }>(SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL, [cik, meta.currentQuarter, limit]);

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
  if (curVal != null && prevVal != null) return round2(curVal - prevVal);
  if (prevShares === 0 && curVal != null) return curVal;
  if (curShares === 0 && prevVal != null) return round2(-prevVal);
  return null;
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

  const [curRes, prevRes] = await Promise.all([
    pool.query<{
      cusip: string;
      ticker: string | null;
      issuer: string;
      shares: number;
      value_usd_thousands: number;
    }>(SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL, [cik, meta.currentQuarter, 5000]),
    pool.query<{
      cusip: string;
      ticker: string | null;
      issuer: string;
      shares: number;
      value_usd_thousands: number;
    }>(SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL, [cik, meta.previousQuarter, 5000]),
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

  const newPositions = enriched
    .filter((r) => r.previousShares === 0 && r.currentShares > 0)
    .sort((a, b) => (b.currentValueUsd ?? 0) - (a.currentValueUsd ?? 0));

  // Full exit: held in prior quarter, absent from latest filing (CUSIP not in current holdings).
  const completelySold = enriched
    .filter((r) => r.previousShares > 0 && r.currentShares === 0)
    .sort((a, b) => (b.previousValueUsd ?? 0) - (a.previousValueUsd ?? 0));

  const adds = enriched
    .filter((r) => r.previousShares > 0 && (r.valueChangeUsd ?? 0) > 0)
    .sort((a, b) => (b.valueChangeUsd ?? 0) - (a.valueChangeUsd ?? 0));

  const trims = enriched
    .filter((r) => (r.valueChangeUsd ?? 0) < 0)
    .sort((a, b) => (a.valueChangeUsd ?? 0) - (b.valueChangeUsd ?? 0));

  const activitySorted = [...enriched]
    .sort((a, b) => Math.abs(b.sharesChange) - Math.abs(a.sharesChange))
    .slice(0, limit);

  return { meta, activity: activitySorted, adds, trims, newPositions, completelySold, previousPortfolioValueUsd };
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

  const cappedLimit = Math.min(200, Math.max(1, limit));

  const [callsRes, putsRes, holdingsRes] = await Promise.all([
    pool.query<FilerOptionDbRow>(SELECT_FILER_CALLS_FOR_QUARTER_SQL, [
      cik,
      meta.currentQuarter,
      cappedLimit,
    ]),
    pool.query<FilerOptionDbRow>(SELECT_FILER_PUTS_FOR_QUARTER_SQL, [
      cik,
      meta.currentQuarter,
      cappedLimit,
    ]),
    pool.query<{ cusip: string; value_usd_thousands: number }>(
      SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL,
      [cik, meta.currentQuarter, 5000]
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
