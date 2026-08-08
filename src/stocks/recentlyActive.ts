import type pg from "pg";
import { getPool } from "../db/pool.js";
import { queryRecentInsiderTransactions } from "../db/insiderTransactions.js";
import { listTrackedInstitutions } from "../institution/institutionAnalytics.js";
import { readPoliticiansRecent } from "../politicians/recent.js";
import { normalizeTicker } from "../politicians/byTicker.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "../institution/mostAccumulated/queries.js";
import { sqlCommonStockOnly } from "../ownership/queries.js";

export type RecentlyActiveSource = "all" | "institution" | "insider" | "politician";

export interface RecentlyActiveFilters {
  source: RecentlyActiveSource;
  from: string | null;
  to: string | null;
}

export interface RecentlyActiveItem {
  source: "Institution" | "Insider" | "Politician";
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
  source: "Institution" | "Insider" | "Politician";
  actorName: string;
  action: string;
}

const MAX_RETURNED_EVENTS = 2500;
const MAX_ITEMS_PER_STOCK_CARD = 8;
const SELECT_RECENT_INSTITUTION_ACTIVITY_SQL = `
WITH latest_filings AS (
  SELECT DISTINCT ON (filer_cik, quarter)
    id AS filing_id,
    filer_cik,
    quarter,
    filing_date
  FROM sec_filing
  WHERE filer_cik = ANY($1::char(10)[])
  ORDER BY filer_cik, quarter, filing_date DESC, id DESC
),
ranked_quarters AS (
  SELECT
    filing_id,
    filer_cik,
    quarter,
    filing_date::text AS filing_date,
    ROW_NUMBER() OVER (
      PARTITION BY filer_cik
      ORDER BY quarter DESC, filing_date DESC, filing_id DESC
    ) AS rn
  FROM latest_filings
)
SELECT
  rq.filer_cik AS institution_id,
  rq.quarter,
  rq.filing_date,
  rq.rn,
  MAX(h.ticker) AS ticker,
  MAX(h.issuer) AS issuer,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands) * 1000)::float8 AS market_value
FROM ranked_quarters rq
INNER JOIN sec_holding h
  ON h.filing_id = rq.filing_id
  AND h.filer_cik = rq.filer_cik
  AND h.quarter = rq.quarter
WHERE rq.rn <= 2
  ${sqlCommonStockOnly("h")}
GROUP BY rq.filer_cik, rq.quarter, rq.filing_date, rq.rn, h.cusip
HAVING SUM(h.shares) > 0
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

function institutionActionLabel(eventType: "add" | "trim" | "new" | "sold-out"): string {
  if (eventType === "new") return "Opened a new position";
  if (eventType === "sold-out") return "Closed position";
  if (eventType === "add") return "Increased position";
  return "Reduced position";
}

function insiderActionLabel(
  acquisitionDisposition: string | null,
  transactionCode: string
): string {
  const code = String(transactionCode || "").toUpperCase();
  if (acquisitionDisposition === "A") return "Bought shares";
  if (acquisitionDisposition === "D") return "Sold shares";
  if (code === "P") return "Bought shares";
  if (code === "S") return "Sold shares";
  return `Filed Form 4 (${code || "trade"})`;
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

async function loadInstitutionEvents(pool: pg.Pool, filters: RecentlyActiveFilters): Promise<NormalizedEvent[]> {
  const institutions = listTrackedInstitutions();
  const events: NormalizedEvent[] = [];
  const institutionNameByCik = new Map(institutions.map((inst) => [inst.cik, inst.name]));
  const res = await pool.query<{
    institution_id: string;
    quarter: string;
    filing_date: string;
    rn: number;
    ticker: string | null;
    issuer: string | null;
    shares: number;
    market_value: number;
  }>(SELECT_RECENT_INSTITUTION_ACTIVITY_SQL, [institutions.map((inst) => inst.cik)]);

  const currentByInstitution = new Map<string, Map<string, { shares: number; marketValue: number }>>();
  const previousByInstitution = new Map<string, Map<string, { shares: number; marketValue: number }>>();
  const filingDateByInstitution = new Map<string, string>();

  for (const row of res.rows) {
    const ticker = row.ticker ? String(row.ticker).trim().toUpperCase() : "";
    if (!ticker) continue;
    const filingDate = toIsoDate(row.filing_date);
    if (!filingDate) continue;
    const target = Number(row.rn) === 1 ? currentByInstitution : previousByInstitution;
    let holdings = target.get(String(row.institution_id));
    if (!holdings) {
      holdings = new Map();
      target.set(String(row.institution_id), holdings);
    }
    holdings.set(ticker, {
      shares: Number(row.shares ?? 0),
      marketValue: Number(row.market_value ?? 0),
    });
    if (Number(row.rn) === 1) {
      filingDateByInstitution.set(String(row.institution_id), filingDate);
    }
  }

  for (const institution of institutions) {
    const filingDate = filingDateByInstitution.get(institution.cik);
    if (!filingDate || !inDateRange(filingDate, filters)) continue;
    const current = currentByInstitution.get(institution.cik) ?? new Map();
    const previous = previousByInstitution.get(institution.cik) ?? new Map();
    const tickers = new Set([...current.keys(), ...previous.keys()]);
    for (const ticker of tickers) {
      const cur = current.get(ticker);
      const prev = previous.get(ticker);
      const curShares = Number(cur?.shares ?? 0);
      const prevShares = Number(prev?.shares ?? 0);
      if (curShares === prevShares) continue;
      let eventType: "add" | "trim" | "new" | "sold-out";
      if (prevShares <= 0 && curShares > 0) eventType = "new";
      else if (curShares <= 0 && prevShares > 0) eventType = "sold-out";
      else if ((cur?.marketValue ?? 0) >= (prev?.marketValue ?? 0)) eventType = "add";
      else eventType = "trim";
      events.push({
        ticker,
        companyName: null,
        filingDate,
        source: "Institution",
        actorName: institutionNameByCik.get(institution.cik) || institution.name,
        action: institutionActionLabel(eventType),
      });
    }
  }

  return events;
}

async function loadInsiderEvents(pool: pg.Pool, filters: RecentlyActiveFilters): Promise<NormalizedEvent[]> {
  const recent = await queryRecentInsiderTransactions({ limit: 1000, sort: "date" }, pool);
  return recent
    .map((row) => {
      const ticker = normalizeTicker(row.ticker || "");
      const filingDate = toIsoDate(row.filingDate || row.transactionDate);
      if (!ticker || !filingDate || !inDateRange(filingDate, filters)) return null;
      return {
        ticker,
        companyName: null,
        filingDate,
        source: "Insider" as const,
        actorName: String(row.insiderName || row.insiderTitle || "Insider"),
        action: insiderActionLabel(row.acquisitionDisposition, row.transactionCode),
      };
    })
    .filter((row): row is NormalizedEvent => Boolean(row));
}

async function loadPoliticianEvents(filters: RecentlyActiveFilters): Promise<NormalizedEvent[]> {
  const payload = readPoliticiansRecent();
  if (!payload) return [];
  const events: NormalizedEvent[] = [];

  for (const bundle of [...payload.house, ...payload.senate]) {
    for (const trade of bundle.trades || []) {
      const ticker =
        normalizeTicker(trade.ticker || "") ||
        normalizeTicker(trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i)?.[1] || "");
      const filingDate = toIsoDate(trade.filingDate || bundle.filingDate || trade.notificationDate);
      if (!ticker || !filingDate || !inDateRange(filingDate, filters)) continue;
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
    source:
      sourceRaw === "institution" || sourceRaw === "insider" || sourceRaw === "politician"
        ? sourceRaw
        : "all",
    from: toIsoDate(url.searchParams.get("from")) ?? null,
    to: toIsoDate(url.searchParams.get("to")) ?? null,
  };
}

let memoryCache: { loadedAt: number; key: string; payload: RecentlyActivePayload } | null = null;
const MEMORY_CACHE_MS = 5 * 60 * 1000;

export async function getRecentlyActiveStocks(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<RecentlyActivePayload> {
  const filters = parseRecentlyActiveFilters(url);
  const key = JSON.stringify(filters);
  const now = Date.now();
  if (memoryCache && memoryCache.key === key && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }

  const events: NormalizedEvent[] = [];

  if (filters.source === "all" || filters.source === "institution") {
    events.push(...(await loadInstitutionEvents(pool, filters)));
  }
  if (filters.source === "all" || filters.source === "insider") {
    events.push(...(await loadInsiderEvents(pool, filters)));
  }
  if (filters.source === "all" || filters.source === "politician") {
    events.push(...(await loadPoliticianEvents(filters)));
  }

  events.sort((a, b) => {
    const byDate = b.filingDate.localeCompare(a.filingDate);
    if (byDate !== 0) return byDate;
    const byTicker = a.ticker.localeCompare(b.ticker);
    if (byTicker !== 0) return byTicker;
    return a.actorName.localeCompare(b.actorName);
  });

  const stockNames = await loadStockNames(
    pool,
    [...new Set(events.map((event) => event.ticker).filter(Boolean))]
  );
  for (const event of events) {
    const stockName = stockNames.get(event.ticker);
    if (stockName) event.companyName = stockName;
  }

  const limitedEvents = events.slice(0, MAX_RETURNED_EVENTS);
  const days = buildDayGroups(limitedEvents);
  const payload: RecentlyActivePayload = {
    computedAt: new Date().toISOString(),
    filters,
    summary: {
      stockCount: days.reduce((sum, day) => sum + day.stocks.length, 0),
      activityItemCount: limitedEvents.length,
    },
    days,
  };

  memoryCache = { loadedAt: now, key, payload };
  return payload;
}
