import type pg from "pg";
import { getPool } from "../db/pool.js";
import { formatSecCik, SEC_TICKERS_URL, secFetchJson, type SecFetchOptions } from "../sec/http.js";
import { getStocksRepository } from "../stocks/stocksRepository.js";

/** Normalized company record sourced from the SEC Company Tickers dataset. */
export interface SecCompanyTicker {
  ticker: string;
  companyName: string;
  cik: string;
}

/** Raw row shape in https://www.sec.gov/files/company_tickers.json */
interface RawSecTickerRow {
  cik_str: number | string;
  ticker: string;
  title: string;
}

export interface ImportSecTickersResult {
  /** Companies parsed from the SEC dataset. */
  total: number;
  /** Rows inserted or updated (every parsed company is upserted). */
  upserted: number;
  /** Number of batched statements executed. */
  batches: number;
}

export interface ImportSecTickersOptions {
  pool?: pg.Pool;
  /** Override the download (used by tests). */
  companies?: SecCompanyTicker[];
  /** Rows per upsert statement. */
  batchSize?: number;
  fetchOptions?: SecFetchOptions;
  onProgress?: (event: { upserted: number; total: number }) => void;
}

const DEFAULT_BATCH_SIZE = 500;

/**
 * Download and parse the full SEC Company Tickers dataset.
 * De-duplicates by ticker (the SEC file can list the same ticker twice).
 */
export async function downloadSecCompanyTickers(
  fetchOptions: SecFetchOptions = {}
): Promise<SecCompanyTicker[]> {
  const raw = await secFetchJson<Record<string, RawSecTickerRow>>(SEC_TICKERS_URL, fetchOptions);

  const seen = new Set<string>();
  const companies: SecCompanyTicker[] = [];
  for (const row of Object.values(raw)) {
    if (!row || row.ticker == null || row.cik_str == null) continue;

    const ticker = String(row.ticker).trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;

    let cik: string;
    try {
      cik = formatSecCik(row.cik_str);
    } catch {
      continue;
    }

    seen.add(ticker);
    companies.push({
      ticker,
      companyName: String(row.title ?? "").trim(),
      cik,
    });
  }

  return companies;
}

function buildUpsertStatement(rowCount: number): string {
  const valuesSql: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const base = i * 3;
    valuesSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, NOW(), NOW())`);
  }

  return `
    INSERT INTO stocks (ticker, company_name, cik, created_at, updated_at)
    VALUES ${valuesSql.join(", ")}
    ON CONFLICT (ticker) DO UPDATE SET
      company_name = COALESCE(EXCLUDED.company_name, stocks.company_name),
      cik = COALESCE(EXCLUDED.cik, stocks.cik),
      updated_at = NOW()
  `.trim();
}

/**
 * Upsert the SEC company directory into the `stocks` table.
 * Idempotent: re-running updates existing rows (conflict on ticker) instead of
 * creating duplicates. Preserves SIC / sector / industry columns populated
 * elsewhere because they are not touched by this statement.
 */
export async function importSecTickers(
  options: ImportSecTickersOptions = {}
): Promise<ImportSecTickersResult> {
  const pool = options.pool ?? getPool();
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);

  await getStocksRepository().ensureSchema();

  const companies =
    options.companies ?? (await downloadSecCompanyTickers(options.fetchOptions));

  let upserted = 0;
  let batches = 0;

  for (let start = 0; start < companies.length; start += batchSize) {
    const batch = companies.slice(start, start + batchSize);
    if (!batch.length) continue;

    const params: Array<string | null> = [];
    for (const company of batch) {
      params.push(company.ticker, company.companyName || null, company.cik || null);
    }

    await pool.query(buildUpsertStatement(batch.length), params);
    upserted += batch.length;
    batches += 1;
    options.onProgress?.({ upserted, total: companies.length });
  }

  return { total: companies.length, upserted, batches };
}
