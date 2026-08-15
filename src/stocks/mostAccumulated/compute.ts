import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadMostAccumulated } from "../../institution/mostAccumulated/service.js";
import type {
  MostAccumulatedPeriod,
  MostAccumulatedPeriodPayload,
} from "../../institution/mostAccumulated/types.js";
import { readPoliticiansRecent } from "../../politicians/recent.js";
import { normalizeTicker } from "../../politicians/byTicker.js";
import type { PoliticianTrade } from "../../politicians/types.js";
import { insiderRoleWeight, signedTransactionValue } from "../../smartMoney/roleWeights.js";
import { convictionScoreFromFinal } from "../../smartMoney/normalize.js";
import { getOrComputeStocksMostAccumulated } from "./cache.js";
import {
  SELECT_INSIDER_FLOW_IN_WINDOW_SQL,
  SELECT_SHARES_OUTSTANDING_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
} from "./queries.js";
import type {
  MarketCapBucket,
  StocksMostAccumulatedCachePayload,
  StocksMostAccumulatedPayload,
  StocksMostAccumulatedPeriod,
  StocksMostAccumulatedPeriodCache,
  StocksMostAccumulatedRow,
  StocksMostAccumulatedSummary,
} from "./types.js";

const INST_WEIGHT = 0.5;
const INSIDER_WEIGHT = 0.35;
const POL_WEIGHT = 0.15;
const NEW_POSITION_BOOST = 1.35;
const MULTI_BUYER_COEFF = 0.2;
const ALL_PERIODS: StocksMostAccumulatedPeriod[] = ["30d", "90d", "year"];

interface InsiderFlowRow {
  ticker: string;
  insider_name: string;
  insider_title: string | null;
  transaction_date: string | null;
  filing_date: string | null;
  transaction_value: number | null;
  transaction_code: string;
  acquisition_disposition: string | null;
}

interface TickerAgg {
  ticker: string;
  companyName: string | null;
  institutionalBuyingUsd: number;
  insiderBuyingUsd: number;
  politicianBuyingUsd: number;
  buyers: Set<string>;
  newPositionCount: number;
  lastFilingDate: string | null;
  rawScore: number;
  reportedValueUsd: number;
  reportedShares: number;
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundScore(n: number): number {
  return Math.round(n * 100) / 100;
}

export function periodLabel(period: StocksMostAccumulatedPeriod): string {
  if (period === "30d") return "Last 30 days";
  if (period === "year") return "Last year";
  return "Last 90 days";
}

export function periodDays(period: StocksMostAccumulatedPeriod): number {
  if (period === "30d") return 30;
  if (period === "year") return 365;
  return 90;
}

/** Map UI periods onto the institutions most-accumulated cache keys. */
function toInstitutionPeriod(period: StocksMostAccumulatedPeriod): MostAccumulatedPeriod {
  if (period === "30d") return "30d";
  if (period === "year") return "year";
  return "quarter";
}

export function parseStocksMostAccumulatedPeriod(
  raw: string | null
): StocksMostAccumulatedPeriod {
  if (raw === "30d" || raw === "year") return raw;
  if (raw === "90d" || raw === "quarter") return "90d";
  return "90d";
}

export function parseMarketCapBucket(raw: string | null): MarketCapBucket {
  if (raw === "mega" || raw === "large" || raw === "mid" || raw === "small") return raw;
  return "";
}

function matchesMarketCap(marketCapUsd: number | null, bucket: MarketCapBucket): boolean {
  if (!bucket) return true;
  const v = Number(marketCapUsd);
  if (!Number.isFinite(v) || v <= 0) return false;
  if (bucket === "mega") return v >= 200e9;
  if (bucket === "large") return v >= 10e9 && v < 200e9;
  if (bucket === "mid") return v >= 2e9 && v < 10e9;
  if (bucket === "small") return v < 2e9;
  return true;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseDateMs(value: string | null): number {
  const iso = toIsoDate(value);
  if (!iso) return 0;
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function recencyFactor(filingDate: string | null, lookbackDays: number): number {
  const ms = parseDateMs(filingDate);
  if (!ms) return 0.75;
  const ageDays = Math.max(0, (Date.now() - ms) / (24 * 60 * 60 * 1000));
  const span = Math.max(lookbackDays, 1);
  return Math.max(0.35, 1 - (ageDays / span) * 0.65);
}

function sizeFactor(usd: number): number {
  if (!Number.isFinite(usd) || usd === 0) return 0;
  return Math.sign(usd) * Math.log1p(Math.abs(usd));
}

function ensureAgg(map: Map<string, TickerAgg>, ticker: string): TickerAgg {
  let row = map.get(ticker);
  if (!row) {
    row = {
      ticker,
      companyName: null,
      institutionalBuyingUsd: 0,
      insiderBuyingUsd: 0,
      politicianBuyingUsd: 0,
      buyers: new Set(),
      newPositionCount: 0,
      lastFilingDate: null,
      rawScore: 0,
      reportedValueUsd: 0,
      reportedShares: 0,
    };
    map.set(ticker, row);
  }
  return row;
}

function applySourceContribution(
  agg: TickerAgg,
  signedUsd: number,
  weight: number,
  buyers: number,
  newPositions: number,
  filingDate: string | null,
  lookbackDays: number
): void {
  if (!Number.isFinite(signedUsd) || signedUsd === 0) return;
  const recency = recencyFactor(filingDate, lookbackDays);
  const buyerMult = 1 + MULTI_BUYER_COEFF * Math.log1p(Math.max(0, buyers));
  const newMult = newPositions > 0 ? NEW_POSITION_BOOST : 1;
  agg.rawScore += weight * sizeFactor(signedUsd) * recency * buyerMult * newMult;
  agg.lastFilingDate = maxDate(agg.lastFilingDate, filingDate);
}

function politicianTradeAmount(trade: PoliticianTrade): number {
  const min = Number(trade.amountMin);
  const max = Number(trade.amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) return (min + max) / 2;
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

function politicianTicker(trade: PoliticianTrade): string | null {
  const direct = normalizeTicker(trade.ticker || "");
  if (direct) return direct;
  const paren = trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
  return paren?.[1] ? normalizeTicker(paren[1]) : null;
}

function tradeDate(trade: PoliticianTrade): string | null {
  return toIsoDate(trade.transactionDate || trade.notificationDate || trade.filingDate);
}

async function loadStockEnrichment(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, { companyName: string | null }>> {
  if (!tickers.length) return new Map();
  const res = await pool.query<{ ticker: string; company_name: string | null }>(
    SELECT_STOCK_ENRICHMENT_SQL,
    [tickers]
  );
  const out = new Map<string, { companyName: string | null }>();
  for (const row of res.rows) {
    out.set(String(row.ticker).toUpperCase(), {
      companyName: row.company_name ? String(row.company_name) : null,
    });
  }
  return out;
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

function applyInstitutionalPayload(
  map: Map<string, TickerAgg>,
  payload: MostAccumulatedPeriodPayload,
  lookbackDays: number
): void {
  if (!payload.available) return;

  // Approximate "as of" filing date from the current period label when it looks like a quarter.
  const periodAsOf = /^\d{4}-Q[1-4]$/.test(payload.currentPeriod)
    ? null
    : toIsoDate(payload.currentPeriod);

  for (const row of payload.stocks) {
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!ticker) continue;
    if (!Number.isFinite(row.netSharesAdded) || row.netSharesAdded === 0) continue;

    let reportedValue = Number(row.reportedValueUsd) || 0;
    const currentShares = Number(row.currentTotalShares) || 0;
    const previousShares = Number(row.previousTotalShares) || 0;
    let px =
      currentShares > 0
        ? reportedValue / currentShares
        : previousShares > 0
          ? reportedValue / previousShares
          : 0;
    // Some 13F value fields are stored 1000× too high (thousands treated as dollars twice).
    if (px > 10_000) {
      reportedValue /= 1000;
      px /= 1000;
    }
    const netUsd = row.netSharesAdded * px;
    if (!Number.isFinite(netUsd) || netUsd === 0) continue;

    const newPositions =
      previousShares <= 0 && currentShares > 0
        ? Math.max(1, row.institutionsBuying)
        : row.isNewTop10
          ? 1
          : 0;

    const agg = ensureAgg(map, ticker);
    if (row.companyName) agg.companyName = row.companyName;
    agg.institutionalBuyingUsd = roundUsd(agg.institutionalBuyingUsd + netUsd);
    agg.reportedValueUsd += reportedValue;
    agg.reportedShares += currentShares;
    agg.newPositionCount += newPositions;
    for (let i = 0; i < Math.max(0, row.institutionsBuying); i++) {
      agg.buyers.add(`inst:${ticker}:${i}`);
    }
    applySourceContribution(
      agg,
      netUsd,
      INST_WEIGHT,
      row.institutionsBuying,
      newPositions,
      periodAsOf,
      lookbackDays
    );
  }
}

async function loadInsiderFlowRows(pool: pg.Pool, lookbackDays: number): Promise<InsiderFlowRow[]> {
  try {
    const res = await pool.query<InsiderFlowRow>(SELECT_INSIDER_FLOW_IN_WINDOW_SQL, [lookbackDays]);
    return res.rows;
  } catch {
    return [];
  }
}

function applyInsiderFlow(
  map: Map<string, TickerAgg>,
  rows: InsiderFlowRow[],
  lookbackDays: number
): void {
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const byTicker = new Map<
    string,
    { netUsd: number; buyers: Set<string>; lastDate: string | null }
  >();

  for (const row of rows) {
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!ticker) continue;
    const filingDate = toIsoDate(row.filing_date) || toIsoDate(row.transaction_date);
    const when = parseDateMs(filingDate);
    if (when && when < cutoff) continue;
    const signed =
      signedTransactionValue(
        row.transaction_value,
        row.transaction_code,
        row.acquisition_disposition
      ) * insiderRoleWeight(row.insider_title);
    if (!signed) continue;
    let stats = byTicker.get(ticker);
    if (!stats) {
      stats = { netUsd: 0, buyers: new Set(), lastDate: null };
      byTicker.set(ticker, stats);
    }
    stats.netUsd += signed;
    stats.lastDate = maxDate(stats.lastDate, filingDate);
    if (signed > 0) {
      const name = String(row.insider_name || "").trim().toLowerCase();
      if (name) stats.buyers.add(`insider:${name}`);
    }
  }

  for (const [ticker, stats] of byTicker) {
    if (!stats.netUsd) continue;
    const agg = ensureAgg(map, ticker);
    agg.insiderBuyingUsd = roundUsd(agg.insiderBuyingUsd + stats.netUsd);
    for (const b of stats.buyers) agg.buyers.add(b);
    applySourceContribution(
      agg,
      stats.netUsd,
      INSIDER_WEIGHT,
      stats.buyers.size,
      0,
      stats.lastDate,
      lookbackDays
    );
  }
}

function accumulatePoliticians(map: Map<string, TickerAgg>, lookbackDays: number): void {
  const payload = readPoliticiansRecent();
  if (!payload) return;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const byTicker = new Map<
    string,
    { netUsd: number; buyers: Set<string>; lastDate: string | null }
  >();

  for (const bundle of [...payload.house, ...payload.senate]) {
    const polKey = String(bundle.politicianName || "")
      .trim()
      .toLowerCase();
    for (const trade of bundle.trades || []) {
      const when = parseDateMs(tradeDate(trade));
      if (when && when < cutoff) continue;
      if (!when && lookbackDays < 365) continue;
      const ticker = politicianTicker(trade);
      if (!ticker) continue;
      const amt = politicianTradeAmount(trade);
      if (amt <= 0) continue;
      let signed = 0;
      if (trade.transactionCategory === "buy") signed = amt;
      else if (trade.transactionCategory === "sell") signed = -amt;
      else continue;

      let stats = byTicker.get(ticker);
      if (!stats) {
        stats = { netUsd: 0, buyers: new Set(), lastDate: null };
        byTicker.set(ticker, stats);
      }
      stats.netUsd += signed;
      stats.lastDate = maxDate(stats.lastDate, tradeDate(trade));
      if (signed > 0 && polKey) stats.buyers.add(`pol:${polKey}`);
    }
  }

  for (const [ticker, stats] of byTicker) {
    if (!stats.netUsd) continue;
    const agg = ensureAgg(map, ticker);
    agg.politicianBuyingUsd = roundUsd(agg.politicianBuyingUsd + stats.netUsd);
    for (const b of stats.buyers) agg.buyers.add(b);
    applySourceContribution(
      agg,
      stats.netUsd,
      POL_WEIGHT,
      stats.buyers.size,
      0,
      stats.lastDate,
      lookbackDays
    );
  }
}

function buildSummary(rows: StocksMostAccumulatedRow[]): StocksMostAccumulatedSummary {
  const top = rows[0] ?? null;
  return {
    topStock: top
      ? {
          ticker: top.ticker,
          companyName: top.companyName,
          accumulationScore: top.accumulationScore,
        }
      : null,
    totalNetBoughtValueUsd: roundUsd(rows.reduce((s, r) => s + r.netBoughtValueUsd, 0)),
    stockCount: rows.length,
    averageBuyerCount:
      rows.length > 0
        ? Math.round((rows.reduce((s, r) => s + r.buyerCount, 0) / rows.length) * 10) / 10
        : 0,
  };
}

function finalizeTickerMap(
  byTicker: Map<string, TickerAgg>,
  sharesOutstanding: Map<string, number>,
  enrichment: Map<string, { companyName: string | null }>
): StocksMostAccumulatedRow[] {
  const rawFinals = [...byTicker.values()].map((r) => r.rawScore);
  const draft: StocksMostAccumulatedRow[] = [];

  for (const agg of byTicker.values()) {
    const netBoughtValueUsd = roundUsd(
      agg.institutionalBuyingUsd + agg.insiderBuyingUsd + agg.politicianBuyingUsd
    );
    if (netBoughtValueUsd === 0 && agg.rawScore === 0) continue;

    const so = sharesOutstanding.get(agg.ticker);
    const impliedPx =
      agg.reportedShares > 0 ? agg.reportedValueUsd / agg.reportedShares : null;
    const marketCapUsd =
      so != null && impliedPx != null && impliedPx > 0
        ? roundUsd(so * impliedPx)
        : agg.reportedValueUsd > 0
          ? roundUsd(agg.reportedValueUsd)
          : null;

    draft.push({
      ticker: agg.ticker,
      companyName: agg.companyName ?? enrichment.get(agg.ticker)?.companyName ?? null,
      accumulationScore: convictionScoreFromFinal(agg.rawScore, rawFinals),
      netBoughtValueUsd,
      institutionalBuyingUsd: roundUsd(agg.institutionalBuyingUsd),
      insiderBuyingUsd: roundUsd(agg.insiderBuyingUsd),
      politicianBuyingUsd: roundUsd(agg.politicianBuyingUsd),
      buyerCount: agg.buyers.size,
      lastFilingDate: agg.lastFilingDate,
      marketCapUsd,
      newPositionCount: agg.newPositionCount,
    });
  }

  return draft
    .filter((row) => row.netBoughtValueUsd > 0)
    .map((row) => ({
      ...row,
      accumulationScore: roundScore(row.accumulationScore),
    }))
    .sort(
      (a, b) =>
        b.accumulationScore - a.accumulationScore ||
        b.netBoughtValueUsd - a.netBoughtValueUsd ||
        a.ticker.localeCompare(b.ticker)
    );
}

function payloadFromCache(
  cache: StocksMostAccumulatedCachePayload,
  period: StocksMostAccumulatedPeriod,
  marketCap: MarketCapBucket
): StocksMostAccumulatedPayload {
  const periodCache = cache.periods[period];
  const stocks = marketCap
    ? periodCache.stocks.filter((row) => matchesMarketCap(row.marketCapUsd, marketCap))
    : periodCache.stocks;
  return {
    computedAt: cache.computedAt,
    period,
    periodLabel: periodCache.periodLabel,
    marketCap,
    summary: marketCap ? buildSummary(stocks) : periodCache.summary,
    stocks,
  };
}

export async function computeStocksMostAccumulatedCache(
  pool: pg.Pool = getPool()
): Promise<StocksMostAccumulatedCachePayload> {
  const lookbackMax = periodDays("year");
  const [instAll, insiderRows, sharesOutstanding] = await Promise.all([
    loadMostAccumulated(pool),
    loadInsiderFlowRows(pool, lookbackMax),
    loadSharesOutstanding(pool),
  ]);

  const computedAt = new Date().toISOString();
  const periods = {} as StocksMostAccumulatedCachePayload["periods"];

  for (const period of ALL_PERIODS) {
    const lookbackDays = periodDays(period);
    const byTicker = new Map<string, TickerAgg>();
    const instPeriod = toInstitutionPeriod(period);
    const inst = instAll.periods[instPeriod];
    if (inst) applyInstitutionalPayload(byTicker, inst, lookbackDays);
    applyInsiderFlow(byTicker, insiderRows, lookbackDays);
    accumulatePoliticians(byTicker, lookbackDays);

    const missingNames = [...byTicker.values()].filter((r) => !r.companyName).map((r) => r.ticker);
    const enrichment = await loadStockEnrichment(pool, missingNames);
    const stocks = finalizeTickerMap(byTicker, sharesOutstanding, enrichment);
    const periodCache: StocksMostAccumulatedPeriodCache = {
      period,
      periodLabel: periodLabel(period),
      summary: buildSummary(stocks),
      stocks,
    };
    periods[period] = periodCache;
  }

  return { computedAt, periods };
}

export async function computeStocksMostAccumulated(
  period: StocksMostAccumulatedPeriod = "90d",
  marketCap: MarketCapBucket = "",
  pool: pg.Pool = getPool()
): Promise<StocksMostAccumulatedPayload> {
  const cache = await computeStocksMostAccumulatedCache(pool);
  return payloadFromCache(cache, period, marketCap);
}

export async function getStocksMostAccumulated(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<StocksMostAccumulatedPayload> {
  const period = parseStocksMostAccumulatedPeriod(url.searchParams.get("period"));
  const marketCap = parseMarketCapBucket(
    url.searchParams.get("marketCap") || url.searchParams.get("size")
  );
  const cache = await getOrComputeStocksMostAccumulated(() => computeStocksMostAccumulatedCache(pool));
  return payloadFromCache(cache, period, marketCap);
}
