import type pg from "pg";
import { getPool } from "../db/pool.js";
import { fetchQuarterPairMap, loadOwnershipMeta } from "../ownership/ownershipAnalytics.js";
import { buildInsiderSide } from "./compare/insiders.js";
import { buildPoliticianSide } from "./compare/politicians.js";
import { isCongressBuy, isCongressSell } from "../politicians/byTicker.js";
import { activeSignalLabels, buildSignalsSide } from "./compare/signals.js";
import {
  isOpenMarketInsiderBuy,
  isOpenMarketInsiderSell,
} from "../insider/openMarketSide.js";

/** Recent insider / Congress notifications: last 7 calendar days. */
const RECENT_NOTIFICATION_DAYS = 7;

/** Institution buy/sale must dominate the other side by this factor (USD flow). */
const INSTITUTION_DOMINANCE_RATIO = 3;

export type WatchlistNoticeTone = "buy" | "sell" | "neutral";

export interface WatchlistNotice {
  kind: "insider" | "congress" | "institution";
  label: string;
  tone: WatchlistNoticeTone;
}

export interface WatchlistActivityRow {
  ticker: string;
  notifications: WatchlistNotice[];
  signals: string[];
  latestActivity: string | null;
  latestQuarter: string | null;
}

function periodStartDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function maxIsoDate(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const raw of values) {
    const v = String(raw || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    if (!best || v > best) best = v;
  }
  return best;
}

function institutionNoticeFromValues(
  buyValue: number,
  sellValue: number
): WatchlistNotice | null {
  if (buyValue <= 0 && sellValue <= 0) return null;
  if (buyValue >= INSTITUTION_DOMINANCE_RATIO * sellValue && buyValue > 0) {
    return { kind: "institution", label: "Institutions Buying", tone: "buy" };
  }
  if (sellValue >= INSTITUTION_DOMINANCE_RATIO * buyValue && sellValue > 0) {
    return { kind: "institution", label: "Institutions Selling", tone: "sell" };
  }
  return null;
}

/** Prefer persisted Signals-tab institutional flow (fast); fall back to live QoQ compute. */
async function buildInstitutionNotice(
  pool: pg.Pool,
  ticker: string
): Promise<{ notice: WatchlistNotice | null; latestQuarter: string | null }> {
  try {
    const cached = await pool.query<{
      buy_value_usd: number | null;
      sell_value_usd: number | null;
    }>(
      `SELECT buy_value_usd, sell_value_usd
       FROM stock_signal
       WHERE ticker = $1 AND category = 'institutional'
       LIMIT 1`,
      [ticker]
    );
    if (cached.rows[0]) {
      const buy = Number(cached.rows[0].buy_value_usd) || 0;
      const sell = Number(cached.rows[0].sell_value_usd) || 0;
      return { notice: institutionNoticeFromValues(buy, sell), latestQuarter: null };
    }
  } catch {
    /* table may be missing — fall through */
  }

  try {
    const meta = await loadOwnershipMeta(pool, ticker);
    if (!meta.currentQuarter || !meta.previousQuarter) {
      return { notice: null, latestQuarter: meta.currentQuarter || null };
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
    const price = meta.stockPrice && meta.stockPrice > 0 ? meta.stockPrice : 1;
    let buyValue = 0;
    let sellValue = 0;
    const funds = new Set([...current.keys(), ...previous.keys()]);
    for (const fund of funds) {
      const cur = current.get(fund)?.shares ?? 0;
      const prev = previous.get(fund)?.shares ?? 0;
      const delta = cur - prev;
      if (delta > 0) buyValue += delta * price;
      else if (delta < 0) sellValue += Math.abs(delta) * price;
    }

    return {
      notice: institutionNoticeFromValues(buyValue, sellValue),
      latestQuarter: meta.currentQuarter,
    };
  } catch {
    return { notice: null, latestQuarter: null };
  }
}

/**
 * Notification chips for watchlist rows:
 * - Recent Insider Purchase and/or Sale as separate pills (≤7 days)
 * - Recent Congress Buy and/or Sale as separate pills (≤7 days)
 * - Institutions Buying/Selling (≥3× USD accumulation vs sale, last reported quarter)
 */
export async function getWatchlistActivityForTicker(
  ticker: string,
  pool: pg.Pool = getPool()
): Promise<WatchlistActivityRow> {
  const sym = String(ticker || "").trim().toUpperCase();
  const recentStart = periodStartDaysAgo(RECENT_NOTIFICATION_DAYS);

  const [institution, insiderBundle] = await Promise.all([
    buildInstitutionNotice(pool, sym),
    buildInsiderSide(pool, sym, recentStart),
  ]);
  const politicianBundle = buildPoliticianSide(sym, recentStart);
  const signals = buildSignalsSide(sym, "latest");

  const notifications: WatchlistNotice[] = [];

  const recentInsiderBuys = insiderBundle.transactions.filter((t) =>
    isOpenMarketInsiderBuy(t.transactionCode)
  ).length;
  const recentInsiderSells = insiderBundle.transactions.filter((t) =>
    isOpenMarketInsiderSell(t.transactionCode)
  ).length;
  if (recentInsiderBuys > 0) {
    notifications.push({
      kind: "insider",
      label: "Recent Insider Purchase",
      tone: "buy",
    });
  }
  if (recentInsiderSells > 0) {
    notifications.push({
      kind: "insider",
      label: "Recent Insider Sale",
      tone: "sell",
    });
  }

  const recentCongressBuys = politicianBundle.trades.filter(isCongressBuy).length;
  const recentCongressSells = politicianBundle.trades.filter(isCongressSell).length;
  if (recentCongressBuys > 0) {
    notifications.push({
      kind: "congress",
      label: "Recent Congress Buy",
      tone: "buy",
    });
  }
  if (recentCongressSells > 0) {
    notifications.push({
      kind: "congress",
      label: "Recent Congress Sale",
      tone: "sell",
    });
  }

  if (institution.notice) notifications.push(institution.notice);

  const insiderLatest = insiderBundle.transactions
    .map((t) => t.transactionDate || t.filingDate)
    .filter(Boolean)
    .sort()
    .reverse()[0] as string | undefined;

  return {
    ticker: sym,
    notifications,
    signals: activeSignalLabels(signals),
    latestActivity: maxIsoDate(insiderLatest, politicianBundle.stats.latestActivityDate),
    latestQuarter: institution.latestQuarter,
  };
}

export async function getWatchlistActivityForTickers(
  tickers: string[],
  pool: pg.Pool = getPool()
): Promise<WatchlistActivityRow[]> {
  const unique = [
    ...new Set(
      tickers
        .map((t) => String(t || "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ].slice(0, 40);

  const concurrency = Math.min(8, Math.max(1, unique.length));
  const rows: WatchlistActivityRow[] = new Array(unique.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < unique.length) {
      const i = nextIndex++;
      const ticker = unique[i]!;
      try {
        rows[i] = await getWatchlistActivityForTicker(ticker, pool);
      } catch {
        rows[i] = {
          ticker,
          notifications: [],
          signals: [],
          latestActivity: null,
          latestQuarter: null,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return rows;
}
