import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { readPoliticiansRecent } from "../../politicians/recent.js";
import { normalizeTicker } from "../../politicians/byTicker.js";
import type { PoliticianTrade } from "../../politicians/types.js";
import {
  SELECT_HOLDER_OVERLAP_COUNT_SQL,
  SELECT_HOLDER_OVERLAP_SQL,
  SELECT_INSIDER_BUYS_FOR_TICKER_SQL,
  SELECT_INSTITUTION_TYPES_SQL,
  SELECT_SECTORS_SQL,
  SELECT_STOCK_META_SQL,
  SELECT_TARGET_HOLDERS_SQL,
} from "./queries.js";
import type {
  HolderOverlapInsider,
  HolderOverlapInstitution,
  HolderOverlapMode,
  HolderOverlapPayload,
  HolderOverlapPolitician,
  HolderOverlapRow,
  MarketCapBucket,
} from "./types.js";

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseHolderOverlapMode(raw: string | null): HolderOverlapMode {
  if (raw === "popularity" || raw === "conviction") return raw;
  return "weighted";
}

export function parseMarketCapBucket(raw: string | null): MarketCapBucket {
  if (raw === "mega" || raw === "large" || raw === "mid" || raw === "small") return raw;
  return "";
}

function parsePage(raw: string | null, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function parsePageSize(raw: string | null, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(5, Math.floor(n)));
}

function politicianAmount(trade: PoliticianTrade): number {
  const min = Number(trade.amountMin);
  const max = Number(trade.amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) return (min + max) / 2;
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

function loadPoliticianBuys(ticker: string, lookbackDays = 365, limit = 25): HolderOverlapPolitician[] {
  const payload = readPoliticiansRecent();
  if (!payload) return [];
  const target = normalizeTicker(ticker);
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const rows: HolderOverlapPolitician[] = [];

  for (const bundle of [...payload.house, ...payload.senate]) {
    for (const trade of bundle.trades || []) {
      if (trade.transactionCategory !== "buy") continue;
      let tradeTicker = normalizeTicker(trade.ticker || "");
      if (tradeTicker !== target) {
        const paren = trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
        tradeTicker = paren ? normalizeTicker(paren[1]) : "";
      }
      if (tradeTicker !== target) continue;
      const dateRaw = trade.transactionDate || trade.notificationDate || trade.filingDate || null;
      const ms = dateRaw ? Date.parse(dateRaw) : 0;
      if (ms && ms < cutoff) continue;
      const amt = politicianAmount(trade);
      if (amt <= 0) continue;
      rows.push({
        name: bundle.politicianName,
        chamber: bundle.chamber ?? null,
        transactionDate: dateRaw,
        estimatedValueUsd: round2(amt),
        transactionCategory: "buy",
      });
    }
  }

  return rows
    .sort((a, b) => String(b.transactionDate || "").localeCompare(String(a.transactionDate || "")))
    .slice(0, limit);
}

async function loadInsiders(
  pool: pg.Pool,
  ticker: string,
  lookbackDays = 365,
  limit = 25
): Promise<HolderOverlapInsider[]> {
  try {
    const res = await pool.query<{
      name: string;
      title: string | null;
      transaction_date: string | null;
      transaction_value: number;
      shares: number;
    }>(SELECT_INSIDER_BUYS_FOR_TICKER_SQL, [ticker, lookbackDays, limit]);
    return res.rows.map((r) => ({
      name: r.name,
      title: r.title,
      transactionDate: r.transaction_date,
      transactionValue: round2(Number(r.transaction_value) || 0),
      shares: Number(r.shares) || 0,
    }));
  } catch {
    return [];
  }
}

export async function getHolderOverlap(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<HolderOverlapPayload> {
  const ticker = String(url.searchParams.get("ticker") || "")
    .trim()
    .toUpperCase();
  const mode = parseHolderOverlapMode(url.searchParams.get("mode"));
  if (!ticker) return emptyPayload("", mode);

  const institutionType = String(url.searchParams.get("institutionType") || "").trim();
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const minInstitutions = Math.max(1, Number(url.searchParams.get("minInstitutions") || 1) || 1);
  const minOverlapPct = Math.max(0, Number(url.searchParams.get("minOverlapPct") || 0) || 0);
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const offset = (page - 1) * pageSize;

  const filterParams = [
    ticker,
    institutionType,
    minInstitutions,
    minOverlapPct,
    sector,
    marketCap,
  ];

  const [countRes, rowsRes, holdersRes, stockMetaRes, sectorsRes, typesRes, insiders] =
    await Promise.all([
      pool.query<{ total: number }>(SELECT_HOLDER_OVERLAP_COUNT_SQL, filterParams),
      pool.query<{
        ticker: string;
        company_name: string | null;
        sector: string | null;
        overlap_count: number;
        overlap_percentage: number;
        weighted_score: number;
        conviction_score: number;
        market_cap_usd: number | null;
        shares_outstanding: number | null;
        total_holders: number;
        current_quarter: string | null;
      }>(SELECT_HOLDER_OVERLAP_SQL, [...filterParams, mode, pageSize, offset]),
      pool.query<{
        cik: string;
        name: string;
        institution_type: string | null;
        shares: number;
        ownership_pct: number | null;
        portfolio_weight: number | null;
        quarter: string | null;
      }>(SELECT_TARGET_HOLDERS_SQL, [ticker, institutionType]),
      pool.query<{ ticker: string; company_name: string | null; sector: string | null }>(
        SELECT_STOCK_META_SQL,
        [ticker]
      ),
      pool.query<{ sector: string }>(SELECT_SECTORS_SQL),
      pool.query<{ type: string }>(SELECT_INSTITUTION_TYPES_SQL),
      loadInsiders(pool, ticker),
    ]);

  const total = Number(countRes.rows[0]?.total) || 0;
  const first = rowsRes.rows[0];
  const holders = holdersRes.rows;
  const resolvedQuarter = first?.current_quarter || holders[0]?.quarter || "";
  const holderCount = Number(first?.total_holders) || holders.length;

  const stocks: HolderOverlapRow[] = rowsRes.rows.map((r) => ({
    ticker: r.ticker,
    companyName: r.company_name,
    sector: r.sector,
    overlapCount: Number(r.overlap_count) || 0,
    overlapPercentage: round2(Number(r.overlap_percentage) || 0),
    weightedScore: round4(Number(r.weighted_score) || 0),
    convictionScore: round4(Number(r.conviction_score) || 0),
    marketCapUsd: null,
  }));

  const institutions: HolderOverlapInstitution[] = holders.map((h) => ({
    cik: String(h.cik),
    name: h.name,
    institutionType: h.institution_type,
    shares: Math.round(Number(h.shares) || 0),
    valueUsd: 0,
    portfolioWeight: round4(Number(h.portfolio_weight) || 0),
  }));

  const politicians = loadPoliticianBuys(ticker);
  const meta = stockMetaRes.rows[0];

  return {
    computedAt: new Date().toISOString(),
    summary: {
      targetTicker: ticker,
      targetCompanyName: meta?.company_name ?? null,
      quarter: resolvedQuarter || "",
      holderCount,
      overlapStockCount: total,
    },
    mode,
    page,
    pageSize,
    total,
    stocks,
    institutions,
    insiders,
    politicians,
    sectors: sectorsRes.rows.map((r) => r.sector),
    institutionTypes: typesRes.rows.map((r) => r.type),
  };
}

function emptyPayload(ticker: string, mode: HolderOverlapMode): HolderOverlapPayload {
  return {
    computedAt: new Date().toISOString(),
    summary: {
      targetTicker: ticker,
      targetCompanyName: null,
      quarter: "",
      holderCount: 0,
      overlapStockCount: 0,
    },
    mode,
    page: 1,
    pageSize: 50,
    total: 0,
    stocks: [],
    institutions: [],
    insiders: [],
    politicians: [],
    sectors: [],
    institutionTypes: [],
  };
}
