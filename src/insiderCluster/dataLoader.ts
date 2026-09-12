import type pg from "pg";
import { getPool } from "../db/pool.js";
import { filterOutlierInsiderBuys } from "./outliers.js";
import type { ClusterLookbackDays, InsiderBuyRow } from "./types.js";

/**
 * Open-market / private purchases only (Form 4 code P).
 * Do not treat disposition "A" alone as a buy — that includes option exercises (M),
 * which often pair with same-day sales and are not open-market accumulation.
 */
export const SELECT_INSIDER_BUYS_IN_WINDOW_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  insider_name AS "insiderName",
  insider_title AS "insiderTitle",
  transaction_date::text AS "transactionDate",
  COALESCE(transaction_value, 0)::float8 AS "transactionValue",
  COALESCE(shares, 0)::float8 AS shares,
  price_per_share::float8 AS "pricePerShare",
  cik
FROM insider_transaction
WHERE ticker IS NOT NULL
  AND BTRIM(ticker) <> ''
  AND NOT is_derivative
  AND transaction_date IS NOT NULL
  AND transaction_date >= (CURRENT_DATE - $1::int)
  AND UPPER(BTRIM(transaction_code)) = 'P'
  AND (
    acquisition_disposition IS NULL
    OR UPPER(BTRIM(acquisition_disposition)) = 'A'
  )
`.trim();

export async function loadInsiderBuyRows(
  lookbackDays: ClusterLookbackDays,
  pool: pg.Pool = getPool()
): Promise<InsiderBuyRow[]> {
  try {
    const res = await pool.query<InsiderBuyRow>(SELECT_INSIDER_BUYS_IN_WINDOW_SQL, [lookbackDays]);
    const rows = res.rows.filter((r) => r.ticker && r.insiderName);
    return filterOutlierInsiderBuys(rows);
  } catch {
    return [];
  }
}
