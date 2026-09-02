import type pg from "pg";
import { getPool, getDatabaseUrl } from "../db/pool.js";
import { getFilingsFundamentals } from "../sec/financials/financialsService.js";
import { clearCompanyFactsCache } from "../sec/financials/companyFacts.js";
import { loadSp500 } from "./sp500.js";

const TICKER_RE = /^[A-Z][A-Z0-9.\-^=]{0,14}$/;

export interface FundamentalsBulkIngestOptions {
  tickers: string[];
  /** Extra pause between tickers (ms) on top of SEC throttling inside the service. */
  delayMs?: number;
  /** Skip tickers that already have rows in sec_financial_period. */
  skipExisting?: boolean;
  /** Re-fetch even when ticker is already in the database. */
  force?: boolean;
  /** Max failure records kept in memory (counts are still accurate). */
  maxFailureRecords?: number;
  onProgress?: (event: FundamentalsBulkProgress) => void;
}

export interface FundamentalsBulkProgress {
  index: number;
  total: number;
  ticker: string;
  status: "skipped" | "ok" | "failed";
  quarterlyPeriods?: number;
  annualPeriods?: number;
  error?: string;
}

export interface FundamentalsBulkIngestResult {
  attempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  failures: Array<{ ticker: string; error: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeTickerList(tickers: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tickers) {
    const ticker = String(raw || "")
      .trim()
      .toUpperCase();
    if (!TICKER_RE.test(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
  }
  return out;
}

export function loadSp500Tickers(): string[] {
  return normalizeTickerList(loadSp500().stocks.map((s) => s.symbol));
}

/** All tickers in the local `stocks` table (SEC company_tickers import). */
export async function loadStocksTableTickers(pool: pg.Pool = getPool()): Promise<string[]> {
  const res = await pool.query<{ ticker: string }>(
    `SELECT UPPER(BTRIM(ticker)) AS ticker
     FROM stocks
     WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''
     ORDER BY ticker`
  );
  return normalizeTickerList(res.rows.map((r) => r.ticker));
}

export async function loadTickersWithStoredFundamentals(
  pool: pg.Pool = getPool()
): Promise<Set<string>> {
  const res = await pool.query<{ ticker: string }>(
    `SELECT DISTINCT UPPER(BTRIM(ticker)) AS ticker
     FROM sec_financial_period
     WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''`
  );
  return new Set(res.rows.map((r) => r.ticker));
}

export async function ingestFundamentalsForTickers(
  options: FundamentalsBulkIngestOptions
): Promise<FundamentalsBulkIngestResult> {
  getDatabaseUrl();

  const delayMs = Math.max(0, options.delayMs ?? 250);
  const force = Boolean(options.force);
  const skipExisting = Boolean(options.skipExisting) && !force;
  const maxFailureRecords = Math.max(1, options.maxFailureRecords ?? 100);

  let tickers = normalizeTickerList(options.tickers);
  const existing = skipExisting ? await loadTickersWithStoredFundamentals() : new Set<string>();

  const result: FundamentalsBulkIngestResult = {
    attempted: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const total = tickers.length;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];

    if (skipExisting && existing.has(ticker)) {
      result.skipped++;
      options.onProgress?.({
        index: i + 1,
        total,
        ticker,
        status: "skipped",
      });
      continue;
    }

    result.attempted++;

    try {
      const payload = await getFilingsFundamentals(ticker);
      result.succeeded++;
      options.onProgress?.({
        index: i + 1,
        total,
        ticker,
        status: "ok",
        quarterlyPeriods: payload.quarterly.length,
        annualPeriods: payload.annual.length,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failed++;
      if (result.failures.length < maxFailureRecords) {
        result.failures.push({ ticker, error });
      }
      options.onProgress?.({
        index: i + 1,
        total,
        ticker,
        status: "failed",
        error,
      });
    } finally {
      // Company Facts payloads are large; drop cached JSON so bulk runs stay bounded.
      clearCompanyFactsCache();
    }

    if (i < tickers.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return result;
}
