/**
 * Builds a per-ticker congressional-trade index from the politician PTR cache,
 * scoped to a trailing window or custom date range. Used to evaluate the
 * `politician` source filters as post-filters over the SQL candidate set.
 */
import { readPoliticiansRecent } from "../../politicians/recent.js";
import { normalizeTicker } from "../../politicians/byTicker.js";
import type { PoliticianTrade } from "../../politicians/types.js";
import type { DateRangeValue, ParsedFilter } from "./FilterTypes.js";

export interface PoliticianTickerEntry {
  ticker: string;
  buyTotalUsd: number;
  sellTotalUsd: number;
  netAmountUsd: number;
  totalAmountUsd: number;
  chambers: Set<string>;
  tradeCount: number;
}

export interface PoliticianIndex {
  available: boolean;
  fetchedAt: string | null;
  byTicker: Map<string, PoliticianTickerEntry>;
}

function amountMid(trade: PoliticianTrade): number {
  const min = Number(trade.amountMin);
  const max = Number(trade.amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) return (min + max) / 2;
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

/** Resolve the active window from period/date-range filters (default last 90 days). */
export function resolvePoliticianWindow(filters: ParsedFilter[]): { from: Date | null; to: Date | null } {
  const range = filters.find((f) => f.definition.id === "politicianDateRange");
  if (range && typeof range.value === "object" && range.value !== null) {
    const { from, to } = range.value as DateRangeValue;
    return { from: from ? new Date(from) : null, to: to ? new Date(to) : null };
  }
  const period = filters.find((f) => f.definition.id === "politicianPeriod");
  const value = period ? String(period.value) : "last90";
  const days = value === "last7" ? 7 : value === "last30" ? 30 : 90;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from, to: null };
}

function inWindow(dateStr: string | null, from: Date | null, to: Date | null): boolean {
  if (!from && !to) return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function buildPoliticianIndex(window: { from: Date | null; to: Date | null }): PoliticianIndex {
  const payload = readPoliticiansRecent();
  const byTicker = new Map<string, PoliticianTickerEntry>();
  if (!payload) return { available: false, fetchedAt: null, byTicker };

  const ingest = (trade: PoliticianTrade) => {
    if (!inWindow(trade.transactionDate || trade.notificationDate, window.from, window.to)) return;
    const ticker = normalizeTicker(trade.ticker || "");
    const resolved = ticker || extractTickerFromAsset(trade);
    if (!resolved) return;
    const amt = amountMid(trade);
    let entry = byTicker.get(resolved);
    if (!entry) {
      entry = {
        ticker: resolved,
        buyTotalUsd: 0,
        sellTotalUsd: 0,
        netAmountUsd: 0,
        totalAmountUsd: 0,
        chambers: new Set(),
        tradeCount: 0,
      };
      byTicker.set(resolved, entry);
    }
    if (trade.transactionCategory === "buy") entry.buyTotalUsd += amt;
    else if (trade.transactionCategory === "sell") entry.sellTotalUsd += amt;
    entry.totalAmountUsd += amt;
    entry.netAmountUsd = entry.buyTotalUsd - entry.sellTotalUsd;
    if (trade.chamber) entry.chambers.add(String(trade.chamber).toLowerCase());
    entry.tradeCount += 1;
  };

  for (const bundle of [...payload.house, ...payload.senate]) {
    for (const trade of bundle.trades) ingest(trade);
  }

  return { available: true, fetchedAt: payload.fetchedAt, byTicker };
}

function extractTickerFromAsset(trade: PoliticianTrade): string {
  const m = trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
  return m ? normalizeTicker(m[1]) : "";
}

/** Returns true when a ticker's politician activity matches a parsed politician filter. */
export function evaluatePoliticianFilter(
  filter: ParsedFilter,
  entry: PoliticianTickerEntry | undefined
): boolean {
  const id = filter.definition.id;
  // Window/scoping filters do not exclude rows on their own.
  if (id === "politicianPeriod" || id === "politicianDateRange") return true;
  if (!entry) return false;

  switch (id) {
    case "politicianBuying":
      return entry.netAmountUsd > 0;
    case "politicianSelling":
      return entry.netAmountUsd < 0;
    case "politicianDollarAmount": {
      const v = Number(filter.value);
      if (filter.operator === "lessThan") return entry.totalAmountUsd < v;
      return entry.totalAmountUsd > v;
    }
    case "chamber": {
      const wanted = (Array.isArray(filter.value) ? filter.value : [String(filter.value)]).map((c) =>
        String(c).toLowerCase()
      );
      return wanted.some((c) => entry.chambers.has(c));
    }
    default:
      return true;
  }
}
