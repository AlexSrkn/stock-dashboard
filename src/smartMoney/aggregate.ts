import type pg from "pg";
import { loadInstitutionHoldings } from "../institution/performance/holdingsLoader.js";
import { sortQuarters } from "../institution/performance/quarters.js";
import { readPoliticiansRecent } from "../politicians/recent.js";
import type { PoliticianTrade } from "../politicians/types.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../ownership/trackedInstitutions.js";
import { formatSecCik } from "../sec/http.js";
import { SELECT_INSIDER_FLOW_ROWS_SQL } from "./queries.js";
import { insiderRoleWeight, signedTransactionValue } from "./roleWeights.js";
import type { TickerRawSignals } from "./types.js";
function politicianTradeAmount(trade: PoliticianTrade): number {
  const min = Number(trade.amountMin);
  const max = Number(trade.amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) {
    return (min + max) / 2;
  }
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

function politicianTicker(trade: PoliticianTrade): string | null {
  const direct = String(trade.ticker || "").trim().toUpperCase();
  if (direct) return direct;
  const paren = trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
  return paren?.[1] ? paren[1].toUpperCase() : null;
}

function signedPoliticianAmount(trade: PoliticianTrade): number {
  const amt = politicianTradeAmount(trade);
  if (!amt) return 0;
  if (trade.transactionCategory === "buy") return amt;
  if (trade.transactionCategory === "sell") return -amt;
  return 0;
}

function addToMap(map: Map<string, number>, ticker: string, delta: number): void {
  if (!ticker || !Number.isFinite(delta) || delta === 0) return;
  map.set(ticker, (map.get(ticker) ?? 0) + delta);
}

/**
 * AUM-weighted QoQ share change in (-1, 1] for one filer/ticker.
 * Uses shares (not market value) so price moves are not counted as flow.
 */
export function filerShareFlow(curShares: number, prevShares: number, aumUsd: number): number {
  const cur = Number.isFinite(curShares) ? curShares : 0;
  const prev = Number.isFinite(prevShares) ? prevShares : 0;
  if (cur === 0 && prev === 0) return 0;
  const denom = Math.max(Math.abs(prev), Math.abs(cur), 1);
  return ((cur - prev) / denom) * Math.log(1 + Math.max(aumUsd, 0));
}

async function loadFilerAumByQuarter(pool: pg.Pool, ciks: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await pool.query<{ filer_cik: string; quarter: string; aum_usd: number }>(
      `SELECT DISTINCT ON (filer_cik, quarter)
         filer_cik,
         quarter,
         GREATEST(COALESCE(total_value, 0), 0) * 1000.0 AS aum_usd
       FROM sec_filing
       WHERE filer_cik = ANY($1::char(10)[])
       ORDER BY filer_cik, quarter,
         holdings_count DESC NULLS LAST,
         total_value DESC NULLS LAST,
         filing_date DESC, id DESC`,
      [ciks]
    );
    for (const row of res.rows) {
      out.set(`${row.filer_cik}::${row.quarter}`, Number(row.aum_usd));
    }
  } catch {
    /* optional */
  }
  return out;
}

export async function loadInstitutionalFlowByTicker(pool: pg.Pool): Promise<Map<string, number>> {
  const ciks = TRACKED_INSTITUTIONAL_CIK_PADDED.map((c) => formatSecCik(c));
  const out = new Map<string, number>();
  try {
    const [holdings, aumByFilerQuarter] = await Promise.all([
      loadInstitutionHoldings(pool, undefined, { maxQuarters: 2 }),
      loadFilerAumByQuarter(pool, ciks),
    ]);
    if (!holdings.length) return out;

    const quarters = sortQuarters(holdings.map((h) => h.quarter));
    const curQ = quarters[quarters.length - 1];
    const prevQ = quarters.length >= 2 ? quarters[quarters.length - 2] : null;
    if (!curQ) return out;

    const sharesByKey = new Map<string, number>();
    for (const h of holdings) {
      if (!h.ticker) continue;
      const shares = h.shares;
      if (shares == null || !Number.isFinite(shares)) continue;
      const key = `${h.institutionId}::${h.quarter}::${h.ticker}`;
      sharesByKey.set(key, (sharesByKey.get(key) ?? 0) + shares);
    }

    const seenInstTicker = new Set<string>();
    for (const h of holdings) {
      if (h.quarter !== curQ || !h.ticker) continue;
      const instTickerKey = `${h.institutionId}::${h.ticker}`;
      if (seenInstTicker.has(instTickerKey)) continue;
      seenInstTicker.add(instTickerKey);

      const curShares = sharesByKey.get(`${h.institutionId}::${curQ}::${h.ticker}`);
      if (curShares == null) {
        if (!out.has(h.ticker)) out.set(h.ticker, 0);
        continue;
      }
      const prevShares = prevQ
        ? (sharesByKey.get(`${h.institutionId}::${prevQ}::${h.ticker}`) ?? 0)
        : 0;
      const aumUsd = aumByFilerQuarter.get(`${h.institutionId}::${curQ}`) ?? 0;
      const flow = filerShareFlow(curShares, prevShares, aumUsd);

      if (!out.has(h.ticker)) out.set(h.ticker, 0);
      if (Number.isFinite(flow)) {
        out.set(h.ticker, (out.get(h.ticker) ?? 0) + flow);
      }
    }
  } catch {
    /* optional when DB empty */
  }
  return out;
}

export async function loadInsiderFlowByTicker(pool: pg.Pool): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await pool.query<{
      ticker: string;
      insider_title: string | null;
      transaction_value: number | null;
      transaction_code: string;
      acquisition_disposition: string | null;
    }>(SELECT_INSIDER_FLOW_ROWS_SQL);

    for (const row of res.rows) {
      const ticker = String(row.ticker || "").trim().toUpperCase();
      if (!ticker) continue;
      const signed = signedTransactionValue(
        row.transaction_value,
        row.transaction_code,
        row.acquisition_disposition
      );
      const weighted = signed * insiderRoleWeight(row.insider_title);
      addToMap(out, ticker, weighted);
    }
  } catch {
    /* optional */
  }
  return out;
}

export function loadPoliticianFlowByTicker(): Map<string, number> {
  const out = new Map<string, number>();
  const payload = readPoliticiansRecent();
  if (!payload) return out;

  for (const bundle of [...payload.house, ...payload.senate]) {
    for (const trade of bundle.trades) {
      const ticker = politicianTicker(trade);
      if (!ticker) continue;
      addToMap(out, ticker, signedPoliticianAmount(trade));
    }
  }
  return out;
}

export function intersectSmartMoneyTickers(
  institutional: Map<string, number>,
  insider: Map<string, number>,
  politician: Map<string, number>
): string[] {
  const tickers: string[] = [];
  for (const ticker of institutional.keys()) {
    if (insider.has(ticker) && politician.has(ticker)) tickers.push(ticker);
  }
  return tickers.sort();
}

export async function loadTickerRawSignals(pool: pg.Pool): Promise<TickerRawSignals[]> {
  const [institutional, insider, politician] = await Promise.all([
    loadInstitutionalFlowByTicker(pool),
    loadInsiderFlowByTicker(pool),
    Promise.resolve(loadPoliticianFlowByTicker()),
  ]);

  return intersectSmartMoneyTickers(institutional, insider, politician).map((ticker) => ({
    ticker,
    institutionalFlowRaw: institutional.get(ticker) ?? 0,
    insiderFlowRaw: insider.get(ticker) ?? 0,
    politicianFlowRaw: politician.get(ticker) ?? 0,
  }));
}
