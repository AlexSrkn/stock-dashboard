import type pg from "pg";
import { getPool } from "../../db/pool.js";
import type { RawOpenMarketTrade } from "./types.js";

/** Sanity bounds — shared with conviction buys for Form 4 parse noise. */
export const MIN_OPEN_MARKET_VALUE_USD = 100;
export const MAX_OPEN_MARKET_VALUE_USD = 250_000_000;
export const MAX_OPEN_MARKET_PRICE = 1_000_000;

/**
 * Open-market buys (P) and sells (S), non-derivative.
 * Sells are loaded only to compute consecutive purchase streaks.
 */
export const SELECT_OPEN_MARKET_PS_SQL = `
SELECT
  it.id,
  UPPER(BTRIM(it.ticker)) AS ticker,
  st.company_name AS "companyName",
  st.sector,
  it.insider_name AS "insiderName",
  it.insider_title AS "insiderTitle",
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
`.trim();

export function isPlausibleBuy(row: RawOpenMarketTrade): boolean {
  if (row.transactionCode !== "P") return false;
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

/** Sells only need identity + date for streak breaks; value noise is ignored. */
export function isUsableSell(row: RawOpenMarketTrade): boolean {
  return row.transactionCode === "S" && Boolean(row.ticker && row.insiderName);
}

export async function loadOpenMarketPurchasesAndSales(
  pool: pg.Pool = getPool()
): Promise<RawOpenMarketTrade[]> {
  const res = await pool.query<RawOpenMarketTrade>(SELECT_OPEN_MARKET_PS_SQL);
  return res.rows.filter((r) => isPlausibleBuy(r) || isUsableSell(r));
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
