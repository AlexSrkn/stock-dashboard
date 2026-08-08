/** Parameterized SQL for ownership analytics (no route logic). */

/**
 * Common-stock share positions only — never merge with puts, calls, or debt.
 * Supports new columns (option_type, security_type) and legacy (put_call, shares_type).
 * @param tableAlias Optional SQL table alias prefix (e.g. `h` → `h.option_type`).
 */
export function sqlCommonStockOnly(tableAlias?: string): string {
  const p = tableAlias ? `${tableAlias}.` : "";
  return `
  AND (
    COALESCE(${p}option_type, ${p}put_call) IS NULL
    OR btrim(COALESCE(${p}option_type, ${p}put_call, '')) = ''
  )
  AND upper(btrim(COALESCE(${p}security_type, ${p}shares_type, 'SH'))) = 'SH'
`.trim();
}

/** @deprecated Use sqlCommonStockOnly() — unqualified single-table queries. */
export const SQL_COMMON_STOCK_ONLY = sqlCommonStockOnly();

/** @deprecated alias */
export const SQL_EQUITY_SHARES_ONLY = SQL_COMMON_STOCK_ONLY;

/** One filing per filer per quarter — latest filing_date (13F-HR/A supersedes). */
export const CTE_LATEST_FILINGS = `
latest_filings AS (
  SELECT DISTINCT ON (filer_cik, quarter)
    id AS filing_id,
    filer_cik,
    quarter
  FROM sec_filing
  ORDER BY filer_cik, quarter, filing_date DESC, id DESC
)
`.trim();

/** Resolve ticker → CUSIP(s) via issuer name (pg_trgm on issuer; scoped to tracked filers). */
export const SELECT_DISTINCT_CUSIPS_BY_ISSUER_SQL = `
SELECT cusip, MAX(issuer) AS issuer
FROM sec_holding
WHERE issuer ILIKE $1
  AND filer_cik = ANY($2::bpchar[])
  ${SQL_COMMON_STOCK_ONLY}
GROUP BY cusip
LIMIT 32;
`.trim();

export const SELECT_RECENT_QUARTERS_FOR_CUSIPS_SQL = `
WITH ${CTE_LATEST_FILINGS}
SELECT h.quarter
FROM sec_holding h
INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
WHERE h.cusip = ANY($1::bpchar[])
  ${sqlCommonStockOnly("h")}
GROUP BY h.quarter
ORDER BY h.quarter DESC
LIMIT $2;
`.trim();

export const SELECT_AGGREGATES_BY_FUND_SQL = `
SELECT
  fund_name,
  SUM(shares)::float8 AS shares,
  SUM(COALESCE(value, value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding
WHERE cusip = ANY($1::bpchar[])
  AND quarter = $2
  ${SQL_COMMON_STOCK_ONLY}
GROUP BY fund_name
ORDER BY value_usd_thousands DESC
LIMIT $3;
`.trim();

/**
 * Common-stock only; grouped by filer — puts/calls never included.
 */
export const SELECT_TRACKED_AGGREGATES_BY_FILER_SQL = `
WITH ${CTE_LATEST_FILINGS}
SELECT
  h.filer_cik,
  MAX(h.fund_name) AS fund_name,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding h
INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
WHERE h.cusip = ANY($1::bpchar[])
  AND h.quarter = $2
  AND h.filer_cik = ANY($3::bpchar[])
  ${sqlCommonStockOnly("h")}
GROUP BY h.filer_cik
HAVING SUM(h.shares) > 0
ORDER BY SUM(h.shares) DESC
LIMIT $4;
`.trim();

export const SELECT_TRACKED_AGGREGATES_BY_FILER_FOR_QUARTERS_SQL = `
WITH ${CTE_LATEST_FILINGS}
SELECT
  h.quarter,
  h.filer_cik,
  MAX(h.fund_name) AS fund_name,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding h
INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
WHERE h.cusip = ANY($1::bpchar[])
  AND h.quarter = ANY($2::text[])
  AND h.filer_cik = ANY($3::bpchar[])
  ${sqlCommonStockOnly("h")}
GROUP BY h.quarter, h.filer_cik;
`.trim();

export const SELECT_ALL_AGGREGATES_BY_FUND_FOR_QUARTERS_SQL = `
SELECT
  quarter,
  fund_name,
  SUM(shares)::float8 AS shares,
  SUM(COALESCE(value, value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding
WHERE cusip = ANY($1::bpchar[])
  AND quarter = ANY($2::text[])
  ${SQL_COMMON_STOCK_ONLY}
GROUP BY quarter, fund_name;
`.trim();

/** Put or call lines only (13F `putCall` / `option_type`). */
export function sqlOptionTypeOnly(optionType: "Call" | "Put", tableAlias?: string): string {
  const p = tableAlias ? `${tableAlias}.` : "";
  const normalized = optionType.toUpperCase();
  return `
  AND upper(btrim(COALESCE(${p}option_type, ${p}put_call, ''))) = '${normalized}'
`.trim();
}

function trackedOptionsByFilerSql(optionType: "Call" | "Put"): string {
  return `
WITH ${CTE_LATEST_FILINGS}
SELECT
  h.filer_cik,
  MAX(h.fund_name) AS fund_name,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding h
INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
WHERE h.cusip = ANY($1::bpchar[])
  AND h.quarter = $2
  AND h.filer_cik = ANY($3::bpchar[])
  ${sqlOptionTypeOnly(optionType, "h")}
GROUP BY h.filer_cik
HAVING SUM(h.shares) > 0
ORDER BY value_usd_thousands DESC
LIMIT $4;
`.trim();
}

export const SELECT_TRACKED_CALLS_BY_FILER_SQL = trackedOptionsByFilerSql("Call");
export const SELECT_TRACKED_PUTS_BY_FILER_SQL = trackedOptionsByFilerSql("Put");

/** Tracked filer holdings per quarter with filing date (includes zero-share rows). */
export const SELECT_TRACKED_HOLDINGS_BY_QUARTER_SQL = `
WITH ${CTE_LATEST_FILINGS}
SELECT
  h.filer_cik,
  MAX(h.fund_name) AS fund_name,
  h.quarter,
  MAX(lf.filing_date)::text AS filing_date,
  SUM(h.shares)::float8 AS shares
FROM sec_holding h
INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
WHERE h.cusip = ANY($1::bpchar[])
  AND h.quarter = ANY($2::text[])
  AND h.filer_cik = ANY($3::bpchar[])
  ${sqlCommonStockOnly("h")}
GROUP BY h.filer_cik, h.quarter;
`.trim();

/** Latest 13F filing date per tracked filer per quarter (for sold-out events). */
export const SELECT_TRACKED_FILER_QUARTER_FILING_DATES_SQL = `
WITH ${CTE_LATEST_FILINGS}
SELECT
  lf.filer_cik,
  lf.quarter,
  f.filing_date::text AS filing_date
FROM latest_filings lf
INNER JOIN sec_filing f ON f.id = lf.filing_id
WHERE lf.filer_cik = ANY($1::bpchar[])
  AND lf.quarter = ANY($2::text[]);
`.trim();

export const SELECT_PRIMARY_CUSIP_BY_HOLDINGS_SQL = `
SELECT cusip
FROM sec_holding
WHERE cusip = ANY($1::bpchar[])
  AND filer_cik = ANY($2::bpchar[])
  ${SQL_COMMON_STOCK_ONLY}
GROUP BY cusip
ORDER BY SUM(shares) DESC
LIMIT 1;
`.trim();
