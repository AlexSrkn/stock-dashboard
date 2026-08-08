import type pg from "pg";
import { getPool } from "../db/pool.js";
import type { ClusterLookbackDays, InsiderBuyRow } from "./types.js";

export const SELECT_INSIDER_BUYS_IN_WINDOW_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  insider_name AS "insiderName",
  insider_title AS "insiderTitle",
  transaction_date::text AS "transactionDate",
  COALESCE(transaction_value, 0)::float8 AS "transactionValue",
  COALESCE(shares, 0)::float8 AS shares,
  cik
FROM insider_transaction
WHERE ticker IS NOT NULL
  AND BTRIM(ticker) <> ''
  AND NOT is_derivative
  AND transaction_date IS NOT NULL
  AND transaction_date >= (CURRENT_DATE - $1::int)
  AND (
    UPPER(BTRIM(transaction_code)) = 'P'
    OR UPPER(BTRIM(acquisition_disposition)) = 'A'
  )
`.trim();

export async function loadInsiderBuyRows(
  lookbackDays: ClusterLookbackDays,
  pool: pg.Pool = getPool()
): Promise<InsiderBuyRow[]> {
  try {
    const res = await pool.query<InsiderBuyRow>(SELECT_INSIDER_BUYS_IN_WINDOW_SQL, [lookbackDays]);
    return res.rows.filter((r) => r.ticker && r.insiderName);
  } catch {
    return [];
  }
}
