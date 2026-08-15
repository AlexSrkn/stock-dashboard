import type pg from "pg";
import { getPool } from "../db/pool.js";
import { openMarketInsiderActionLabel } from "../insider/openMarketSide.js";
import { readPoliticiansRecent } from "../politicians/recent.js";
import { normalizeTicker } from "../politicians/byTicker.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "../institution/mostAccumulated/queries.js";

export type RecentlyActiveSource = "all" | "insider" | "politician";

export interface RecentlyActiveFilters {
  source: RecentlyActiveSource;
  from: string | null;
  to: string | null;
}

export interface RecentlyActiveItem {
  source: "Insider" | "Politician";
  actorName: string;
  action: string;
  filingDate: string;
}

export interface RecentlyActiveStockCard {
  ticker: string;
  companyName: string | null;
  filingDate: string;
  itemCount: number;
  overflowCount: number;
  items: RecentlyActiveItem[];
}

export interface RecentlyActiveDayGroup {
  date: string;
  stocks: RecentlyActiveStockCard[];
}

export interface RecentlyActivePayload {
  computedAt: string;
  filters: RecentlyActiveFilters;
  summary: {
    stockCount: number;
    activityItemCount: number;
  };
  days: RecentlyActiveDayGroup[];
}

interface NormalizedEvent {
  ticker: string;
  companyName: string | null;
  filingDate: string;
  source: "Insider" | "Politician";
  actorName: string;
  action: string;
}

const MAX_RETURNED_EVENTS = 2500;
const MAX_ITEMS_PER_STOCK_CARD = 8;
const INSIDER_LOOKBACK_DAYS = 180;
const INSIDER_FEED_LIMIT = 1000;
const EVENT_CACHE_MS = 15 * 60 * 1000;

const SELECT_RECENT_INSIDER_FEED_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  insider_name,
  insider_title,
  filing_date::text AS filing_date,
  transaction_date::text AS transaction_date,
  transaction_code,
  acquisition_disposition
FROM insider_transaction
WHERE ticker IS NOT NULL
  AND ticker <> ''
  AND NOT is_derivative
  AND UPPER(transaction_code) IN ('P', 'S')
  AND transaction_date >= (CURRENT_DATE - $1::int)
ORDER BY transaction_date DESC
LIMIT $2
`.trim();

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

function inDateRange(value: string, filters: RecentlyActiveFilters): boolean {
  if (filters.from && value < filters.from) return false;
  if (filters.to && value > filters.to) return false;
  return true;
}

function insiderActionLabel(
  acquisitionDisposition: string | null,
  transactionCode: string
): string {
  return openMarketInsiderActionLabel(transactionCode, acquisitionDisposition);
}

function politicianActionLabel(category: string): string {
  if (category === "buy") return "Disclosed a purchase";
  if (category === "sell") return "Disclosed a sale";
  if (category === "exchange") return "Disclosed an exchange";
  return "Disclosed a trade";
}

async function loadStockNames(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, string | null>> {
  if (!tickers.length) return new Map();
  const res = await pool.query<{ ticker: string; company_name: string | null }>(
    SELECT_STOCK_ENRICHMENT_SQL,
    [tickers]
  );
  const out = new Map<string, string | null>();
  for (const row of res.rows) {
    out.set(String(row.ticker).toUpperCase(), row.company_name ? String(row.company_name) : null);
  }
  return out;
}

async function loadInsiderEvents(pool: pg.Pool): Promise<NormalizedEvent[]> {
  const res = await pool.query<{
    ticker: string | null;
    insider_name: string | null;
    insider_title: string | null;
    filing_date: string | null;
    transaction_date: string | null;
    transaction_code: string;
    acquisition_disposition: string | null;
  }>(SELECT_RECENT_INSIDER_FEED_SQL, [INSIDER_LOOKBACK_DAYS, INSIDER_FEED_LIMIT]);

  return res.rows
    .map((row) => {
      const ticker = normalizeTicker(row.ticker || "");
      const filingDate = toIsoDate(row.filing_date || row.transaction_date);
      if (!ticker || !filingDate) return null;
      return {
        ticker,
        companyName: null,
        filingDate,
        source: "Insider" as const,
        actorName: String(row.insider_name || row.insider_title || "Insider"),
        action: insiderActionLabel(row.acquisition_disposition, row.transaction_code),
      };
    })
    .filter((row): row is NormalizedEvent => Boolean(row));
}

function loadPoliticianEvents(): NormalizedEvent[] {
  const payload = readPoliticiansRecent();
  if (!payload) return [];
  const events: NormalizedEvent[] = [];

  for (const bundle of [...payload.house, ...payload.senate]) {
    for (const trade of bundle.trades || []) {
      const ticker =
        normalizeTicker(trade.ticker || "") ||
        normalizeTicker(trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i)?.[1] || "");
      const filingDate = toIsoDate(trade.filingDate || bundle.filingDate || trade.notificationDate);
      if (!ticker || !filingDate) continue;
      events.push({
        ticker,
        companyName: trade.assetName ? String(trade.assetName) : null,
        filingDate,
        source: "Politician",
        actorName: String(trade.politicianName || bundle.politicianName || "Member of Congress"),
        action: politicianActionLabel(String(trade.transactionCategory || "")),
      });
    }
  }

  return events;
}

function buildDayGroups(events: NormalizedEvent[]): RecentlyActiveDayGroup[] {
  const byDay = new Map<string, Map<string, RecentlyActiveStockCard>>();

  for (const event of events) {
    let byTicker = byDay.get(event.filingDate);
    if (!byTicker) {
      byTicker = new Map();
      byDay.set(event.filingDate, byTicker);
    }
    let card = byTicker.get(event.ticker);
    if (!card) {
      card = {
        ticker: event.ticker,
        companyName: event.companyName,
        filingDate: event.filingDate,
        itemCount: 0,
        overflowCount: 0,
        items: [],
      };
      byTicker.set(event.ticker, card);
    }
    if (!card.companyName && event.companyName) card.companyName = event.companyName;
    card.itemCount += 1;
    if (card.items.length < MAX_ITEMS_PER_STOCK_CARD) {
      card.items.push({
        source: event.source,
        actorName: event.actorName,
        action: event.action,
        filingDate: event.filingDate,
      });
    } else {
      card.overflowCount += 1;
    }
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, stocksMap]) => ({
      date,
      stocks: [...stocksMap.values()].sort((a, b) => {
        if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount;
        return a.ticker.localeCompare(b.ticker);
      }),
    }));
}

export function parseRecentlyActiveFilters(url: URL): RecentlyActiveFilters {
  const sourceRaw = url.searchParams.get("source");
  return {
    source: sourceRaw === "insider" || sourceRaw === "politician" ? sourceRaw : "all",
    from: toIsoDate(url.searchParams.get("from")) ?? null,
    to: toIsoDate(url.searchParams.get("to")) ?? null,
  };
}

let eventCache: { loadedAt: number; events: NormalizedEvent[] } | null = null;
let eventInflight: Promise<NormalizedEvent[]> | null = null;

async function loadBaseRecentlyActiveEvents(pool: pg.Pool): Promise<NormalizedEvent[]> {
  const now = Date.now();
  if (eventCache && now - eventCache.loadedAt < EVENT_CACHE_MS) return eventCache.events;
  if (eventInflight) return eventInflight;

  eventInflight = (async () => {
    const [insider, politician] = await Promise.all([
      loadInsiderEvents(pool),
      Promise.resolve(loadPoliticianEvents()),
    ]);
    const events = [...insider, ...politician];
    const names = await loadStockNames(
      pool,
      [...new Set(events.map((event) => event.ticker).filter(Boolean))]
    );
    for (const event of events) {
      const stockName = names.get(event.ticker);
      if (stockName) event.companyName = stockName;
    }
    eventCache = { loadedAt: Date.now(), events };
    return events;
  })().finally(() => {
    eventInflight = null;
  });

  return eventInflight;
}

export async function getRecentlyActiveStocks(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<RecentlyActivePayload> {
  const filters = parseRecentlyActiveFilters(url);
  const events = (await loadBaseRecentlyActiveEvents(pool)).filter((event) => {
    if (filters.source !== "all" && event.source.toLowerCase() !== filters.source) return false;
    return inDateRange(event.filingDate, filters);
  });

  events.sort((a, b) => {
    const byDate = b.filingDate.localeCompare(a.filingDate);
    if (byDate !== 0) return byDate;
    const byTicker = a.ticker.localeCompare(b.ticker);
    if (byTicker !== 0) return byTicker;
    return a.actorName.localeCompare(b.actorName);
  });

  const limitedEvents = events.slice(0, MAX_RETURNED_EVENTS);
  const days = buildDayGroups(limitedEvents);
  return {
    computedAt: new Date().toISOString(),
    filters,
    summary: {
      stockCount: days.reduce((sum, day) => sum + day.stocks.length, 0),
      activityItemCount: limitedEvents.length,
    },
    days,
  };
}
