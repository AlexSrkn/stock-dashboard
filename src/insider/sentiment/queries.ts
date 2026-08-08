import type pg from "pg";
import { getPool } from "../../db/pool.js";
import type { RawSentimentTrade } from "./types.js";

export const MIN_OPEN_MARKET_VALUE_USD = 100;
export const MAX_OPEN_MARKET_VALUE_USD = 250_000_000;
export const MAX_OPEN_MARKET_PRICE = 1_000_000;

/**
 * Open-market buys (P) and sells (S), non-derivative only.
 * Excludes options/RSUs/grants/gifts/conversions (non-P/S or derivative).
 */
export const SELECT_OPEN_MARKET_PS_SQL = `
SELECT
  it.id,
  UPPER(BTRIM(it.ticker)) AS ticker,
  st.company_name AS "companyName",
  st.sector,
  it.insider_name AS "insiderName",
  it.filing_date::text AS "filingDate",
  it.transaction_date::text AS "transactionDate",
  UPPER(BTRIM(it.transaction_code)) AS "transactionCode",
  COALESCE(it.shares, 0)::float8 AS shares,
  it.price_per_share::float8 AS "pricePerShare",
  COALESCE(
    it.transaction_value,
    CASE
      WHEN it.shares IS NOT NULL AND it.price_per_share IS NOT NULL
      THEN it.shares * it.price_per_share
      ELSE 0
    END
  )::float8 AS "valueUsd"
FROM insider_transaction it
LEFT JOIN stocks st ON UPPER(BTRIM(st.ticker)) = UPPER(BTRIM(it.ticker))
WHERE it.ticker IS NOT NULL
  AND BTRIM(it.ticker) <> ''
  AND NOT it.is_derivative
  AND UPPER(BTRIM(it.transaction_code)) IN ('P', 'S')
  AND COALESCE(it.shares, 0) > 0
  AND it.price_per_share IS NOT NULL
  AND it.price_per_share > 0
  AND it.price_per_share <= ${MAX_OPEN_MARKET_PRICE}
`.trim();

export function isPlausibleOpenMarketTrade(row: {
  ticker: string;
  insiderName: string;
  transactionCode: string;
  shares: number;
  pricePerShare: number | null;
  valueUsd: number;
}): boolean {
  const code = String(row.transactionCode || "").toUpperCase();
  if (code !== "P" && code !== "S") return false;
  if (!row.ticker || !row.insiderName) return false;
  if (!Number.isFinite(row.shares) || row.shares <= 0) return false;
  if (!Number.isFinite(row.valueUsd)) return false;
  if (row.valueUsd < MIN_OPEN_MARKET_VALUE_USD || row.valueUsd > MAX_OPEN_MARKET_VALUE_USD) {
    return false;
  }
  if (
    row.pricePerShare == null ||
    !Number.isFinite(row.pricePerShare) ||
    row.pricePerShare <= 0 ||
    row.pricePerShare > MAX_OPEN_MARKET_PRICE
  ) {
    return false;
  }
  return true;
}

export async function loadOpenMarketSentimentTrades(
  pool: pg.Pool = getPool(),
  opts: { dateFrom?: string | null; dateTo?: string | null } = {}
): Promise<RawSentimentTrade[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let p = 1;

  if (opts.dateFrom) {
    conditions.push(`COALESCE(it.transaction_date, it.filing_date) >= $${p}::date`);
    params.push(opts.dateFrom);
    p++;
  }
  if (opts.dateTo) {
    conditions.push(`COALESCE(it.transaction_date, it.filing_date) <= $${p}::date`);
    params.push(opts.dateTo);
    p++;
  }

  const sql =
    conditions.length > 0
      ? `${SELECT_OPEN_MARKET_PS_SQL} AND ${conditions.join(" AND ")}`
      : SELECT_OPEN_MARKET_PS_SQL;

  const res = await pool.query<RawSentimentTrade>(sql, params);
  return res.rows
    .filter(isPlausibleOpenMarketTrade)
    .map((r) => ({
      ...r,
      transactionCode: (String(r.transactionCode).toUpperCase() === "S" ? "S" : "P") as "P" | "S",
    }));
}

export async function loadSharesOutstandingMap(
  pool: pg.Pool = getPool()
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await pool.query<{ ticker: string; shares_outstanding: number | null }>(`
      SELECT DISTINCT ON (UPPER(BTRIM(ticker)))
        UPPER(BTRIM(ticker)) AS ticker,
        (metrics->>'shares_outstanding')::float8 AS shares_outstanding
      FROM sec_financial_period
      WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''
        AND metrics ? 'shares_outstanding'
      ORDER BY UPPER(BTRIM(ticker)), period_end DESC NULLS LAST
    `);
    for (const row of res.rows) {
      const so = Number(row.shares_outstanding);
      if (row.ticker && Number.isFinite(so) && so > 0) out.set(row.ticker, so);
    }
  } catch {
    /* optional */
  }
  return out;
}
