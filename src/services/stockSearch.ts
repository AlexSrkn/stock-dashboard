import type pg from "pg";
import { getPool } from "../db/pool.js";

export interface StockSearchResult {
  ticker: string;
  companyName: string | null;
  cik: string | null;
}

export interface StockSearchOptions {
  limit?: number;
  pool?: pg.Pool;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Escape LIKE/ILIKE wildcards so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Search the local stock directory by ticker or company name.
 *
 * Case-insensitive. Results are ranked:
 *   0. Exact ticker match
 *   1. Ticker starts with query
 *   2. Company name starts with query
 *   3. Company name contains query
 * Ties break by shorter ticker, then alphabetical.
 */
export async function searchStocks(
  query: string,
  options: StockSearchOptions = {}
): Promise<StockSearchResult[]> {
  const q = String(query ?? "").trim();
  if (!q) return [];

  const pool = options.pool ?? getPool();
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));
  const like = escapeLike(q);

  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    cik: string | null;
  }>(
    `
    SELECT ticker, company_name, cik
    FROM stocks
    WHERE UPPER(ticker) LIKE UPPER($2) || '%' ESCAPE '\\'
       OR company_name ILIKE '%' || $2 || '%' ESCAPE '\\'
    ORDER BY
      CASE
        WHEN UPPER(ticker) = UPPER($1) THEN 0
        WHEN UPPER(ticker) LIKE UPPER($2) || '%' ESCAPE '\\' THEN 1
        WHEN company_name ILIKE $2 || '%' ESCAPE '\\' THEN 2
        WHEN company_name ILIKE '%' || $2 || '%' ESCAPE '\\' THEN 3
        ELSE 4
      END ASC,
      LENGTH(ticker) ASC,
      ticker ASC
    LIMIT $3
    `,
    [q, like, limit]
  );

  return res.rows.map((row) => ({
    ticker: String(row.ticker || "").toUpperCase(),
    companyName: row.company_name,
    cik: row.cik ? String(row.cik).trim() : null,
  }));
}
