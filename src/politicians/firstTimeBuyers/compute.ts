import { getPool } from "../../db/pool.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "../../institution/mostAccumulated/queries.js";
import {
  amountMid,
  parseTradeDateMs,
  politicianKey,
  resolveTicker,
  tradeDate,
} from "../analytics/compute.js";
import { readPoliticiansRecent, type PoliticianFilingBundle } from "../recent.js";
import { DEFAULT_MIN_YEARS_SINCE_LAST_BUY } from "./config.js";
import { detectPoliticianFirstTimeBuys, type RawPoliticianBuy } from "./detect.js";
import { round2 } from "./dates.js";
import type {
  PoliticianFirstTimeBuyerRow,
  PoliticianFirstTimeBuyersCachePayload,
} from "./types.js";

function isValidTicker(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(ticker);
}

function disclosureDate(trade: {
  notificationDate: string | null;
  filingDate: string | null;
}): string | null {
  return trade.notificationDate || trade.filingDate || null;
}

function flattenBuys(bundles: PoliticianFilingBundle[]): RawPoliticianBuy[] {
  const rows: RawPoliticianBuy[] = [];
  for (const bundle of bundles) {
    const key = bundle.politicianKey || politicianKey(bundle.politicianName);
    const party = bundle.party ?? null;
    for (const trade of bundle.trades || []) {
      if (trade.transactionCategory !== "buy") continue;
      const ticker = resolveTicker(trade);
      if (!ticker || !isValidTicker(ticker)) continue;
      const when = parseTradeDateMs(tradeDate(trade));
      const mid = amountMid(trade);
      rows.push({
        politicianKey: key,
        politicianName: bundle.politicianName,
        chamber: bundle.chamber,
        state: trade.state
          ? String(trade.state).toUpperCase()
          : bundle.state
            ? String(bundle.state).toUpperCase()
            : null,
        party: trade.party ?? party,
        ticker,
        assetName: trade.assetName ? String(trade.assetName).trim() || null : null,
        transactionDate: trade.transactionDate || tradeDate(trade),
        disclosureDate: disclosureDate(trade),
        dateMs: when || 0,
        estimatedValue: round2(mid > 0 ? mid : 0),
      });
    }
  }
  return rows;
}

async function loadStockEnrichment(
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  if (!tickers.length) return out;
  try {
    const pool = getPool();
    const res = await pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
    }>(SELECT_STOCK_ENRICHMENT_SQL, [tickers]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        companyName: row.company_name ? String(row.company_name) : null,
        sector: row.sector ? String(row.sector) : null,
      });
    }
  } catch {
    /* optional */
  }
  return out;
}

export async function computePoliticianFirstTimeBuyers(
  opts: { minYears?: number } = {}
): Promise<PoliticianFirstTimeBuyersCachePayload> {
  const minYears = opts.minYears ?? DEFAULT_MIN_YEARS_SINCE_LAST_BUY;
  const payload = readPoliticiansRecent();
  if (!payload) {
    return {
      version: 1,
      computedAt: new Date().toISOString(),
      fetchedAt: null,
      minYearsThreshold: minYears,
      rows: [],
      sectors: [],
      politicians: [],
      states: [],
      parties: [],
    };
  }

  const buys = flattenBuys([...payload.house, ...payload.senate]);
  const qualifying = detectPoliticianFirstTimeBuys(buys, minYears);
  const tickers = [...new Set(qualifying.map((q) => q.buy.ticker))];
  const enrichment = await loadStockEnrichment(tickers);

  const rows: PoliticianFirstTimeBuyerRow[] = qualifying.map((q) => {
    const stock = enrichment.get(q.buy.ticker);
    return {
      ticker: q.buy.ticker,
      companyName: stock?.companyName || q.buy.assetName,
      sector: stock?.sector || null,
      marketCapUsd: null,
      politicianKey: q.buy.politicianKey,
      politicianName: q.buy.politicianName,
      party: q.buy.party,
      state: q.buy.state,
      chamber: q.buy.chamber,
      transactionDate: q.buy.transactionDate,
      disclosureDate: q.buy.disclosureDate,
      estimatedPurchaseValue: q.buy.estimatedValue,
      firstRecordedPurchase: q.firstRecordedPurchase,
      previousBuyDate: q.previousBuyDate,
      yearsSinceLastBuy: q.yearsSinceLastBuy,
      previousBuyCount: q.previousBuyCount,
      totalHistoricalBuyCount: q.totalHistoricalBuyCount,
      firstPurchaseDate: q.firstPurchaseDate,
      latestPurchaseDate: q.latestPurchaseDate,
    };
  });

  rows.sort((a, b) => {
    const am = parseTradeDateMs(a.transactionDate) || 0;
    const bm = parseTradeDateMs(b.transactionDate) || 0;
    return bm - am || a.ticker.localeCompare(b.ticker);
  });

  const sectors = [
    ...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s))),
  ].sort();
  const politicianMap = new Map<string, string>();
  const states = new Set<string>();
  const parties = new Set<string>();
  for (const row of rows) {
    politicianMap.set(row.politicianKey, row.politicianName);
    if (row.state) states.add(row.state);
    if (row.party) parties.add(row.party);
  }

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    fetchedAt: payload.fetchedAt,
    minYearsThreshold: minYears,
    rows,
    sectors,
    politicians: [...politicianMap.entries()]
      .map(([politicianKey, politicianName]) => ({ politicianKey, politicianName }))
      .sort((a, b) => a.politicianName.localeCompare(b.politicianName)),
    states: [...states].sort(),
    parties: [...parties].sort(),
  };
}
