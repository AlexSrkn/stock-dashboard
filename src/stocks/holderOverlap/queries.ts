/**

 * Conceptual schema mapping:

 *   institutions → ownership_holding.institution_* / institution

 *   holdings     → ownership_holding (precomputed current-quarter 13F book)

 *   stocks       → stocks

 *   portfolio_weight ≈ shares_in_ticker / institution_total_shares

 *

 * Prefer ownership_holding over raw sec_holding because ticker is resolved

 * during ownership:build-cache (sec_holding.ticker is often null).

 *

 * Params ($1..$9) for SELECT_HOLDER_OVERLAP_SQL:

 *   $1 ticker, $2 institutionType, $3 minInstitutions, $4 minOverlapPct,

 *   $5 sector, $6 marketCap bucket, $7 mode, $8 limit, $9 offset

 *

 * Market-cap filter uses ownership_cache.shares_outstanding as a size proxy

 * (true USD market cap needs a price feed we don't store here):

 *   mega  >= 5e9 SO, large 5e8–5e9, mid 1e8–5e8, small < 1e8

 */



export const SELECT_HOLDER_OVERLAP_SQL = `

WITH target_holders AS (

  SELECT

    oh.institution_cik,

    oh.institution_name,

    oh.institution_type,

    oh.shares AS target_shares,

    oh.ownership_pct AS target_ownership_pct

  FROM ownership_holding oh

  WHERE oh.ticker = UPPER(BTRIM($1::text))

    AND ($2::text = '' OR oh.institution_type = $2)

),

holder_count AS (

  SELECT COUNT(*)::int AS total_holders FROM target_holders

),

inst_totals AS (

  SELECT

    oh.institution_cik,

    SUM(oh.shares)::float8 AS total_shares

  FROM ownership_holding oh

  INNER JOIN target_holders th ON th.institution_cik = oh.institution_cik

  GROUP BY oh.institution_cik

),

overlap AS (

  SELECT

    oh.ticker,

    COUNT(*)::int AS overlap_count,

    SUM(oh.shares / NULLIF(it.total_shares, 0))::float8 AS weighted_score,

    AVG(oh.shares / NULLIF(it.total_shares, 0))::float8 AS conviction_score

  FROM ownership_holding oh

  INNER JOIN target_holders th ON th.institution_cik = oh.institution_cik

  INNER JOIN inst_totals it ON it.institution_cik = oh.institution_cik

  WHERE oh.ticker <> UPPER(BTRIM($1::text))

  GROUP BY oh.ticker

),

enriched AS (

  SELECT

    o.ticker,

    st.company_name,

    st.sector,

    o.overlap_count,

    CASE

      WHEN hc.total_holders > 0 THEN (o.overlap_count::float8 / hc.total_holders::float8) * 100.0

      ELSE 0

    END AS overlap_percentage,

    o.weighted_score,

    o.conviction_score,

    oc.shares_outstanding,

    hc.total_holders,

    COALESCE(oc.current_quarter, (

      SELECT current_quarter FROM ownership_cache WHERE current_quarter IS NOT NULL LIMIT 1

    )) AS current_quarter

  FROM overlap o

  CROSS JOIN holder_count hc

  LEFT JOIN stocks st ON st.ticker = o.ticker

  LEFT JOIN ownership_cache oc ON oc.ticker = o.ticker

)

SELECT

  ticker,

  company_name,

  sector,

  overlap_count,

  overlap_percentage,

  weighted_score,

  conviction_score,

  NULL::float8 AS market_cap_usd,

  shares_outstanding,

  total_holders,

  current_quarter

FROM enriched

WHERE overlap_count >= $3::int

  AND overlap_percentage >= $4::float8

  AND ($5::text = '' OR sector = $5)

  AND (

    $6::text = ''

    OR ($6 = 'mega' AND shares_outstanding >= 5e9)

    OR ($6 = 'large' AND shares_outstanding >= 5e8 AND shares_outstanding < 5e9)

    OR ($6 = 'mid' AND shares_outstanding >= 1e8 AND shares_outstanding < 5e8)

    OR ($6 = 'small' AND shares_outstanding IS NOT NULL AND shares_outstanding < 1e8)

  )

ORDER BY

  CASE WHEN $7::text = 'popularity' THEN overlap_count END DESC NULLS LAST,

  CASE WHEN $7::text = 'conviction' THEN conviction_score END DESC NULLS LAST,

  CASE WHEN $7::text = 'weighted' THEN weighted_score END DESC NULLS LAST,

  weighted_score DESC,

  overlap_count DESC,

  ticker ASC

LIMIT $8::int OFFSET $9::int

`.trim();



export const SELECT_HOLDER_OVERLAP_COUNT_SQL = `

WITH target_holders AS (

  SELECT oh.institution_cik

  FROM ownership_holding oh

  WHERE oh.ticker = UPPER(BTRIM($1::text))

    AND ($2::text = '' OR oh.institution_type = $2)

),

holder_count AS (

  SELECT COUNT(*)::int AS total_holders FROM target_holders

),

overlap AS (

  SELECT

    oh.ticker,

    COUNT(*)::int AS overlap_count

  FROM ownership_holding oh

  INNER JOIN target_holders th ON th.institution_cik = oh.institution_cik

  WHERE oh.ticker <> UPPER(BTRIM($1::text))

  GROUP BY oh.ticker

),

enriched AS (

  SELECT

    o.ticker,

    st.sector,

    o.overlap_count,

    CASE

      WHEN hc.total_holders > 0 THEN (o.overlap_count::float8 / hc.total_holders::float8) * 100.0

      ELSE 0

    END AS overlap_percentage,

    oc.shares_outstanding

  FROM overlap o

  CROSS JOIN holder_count hc

  LEFT JOIN stocks st ON st.ticker = o.ticker

  LEFT JOIN ownership_cache oc ON oc.ticker = o.ticker

)

SELECT COUNT(*)::int AS total

FROM enriched

WHERE overlap_count >= $3::int

  AND overlap_percentage >= $4::float8

  AND ($5::text = '' OR sector = $5)

  AND (

    $6::text = ''

    OR ($6 = 'mega' AND shares_outstanding >= 5e9)

    OR ($6 = 'large' AND shares_outstanding >= 5e8 AND shares_outstanding < 5e9)

    OR ($6 = 'mid' AND shares_outstanding >= 1e8 AND shares_outstanding < 5e8)

    OR ($6 = 'small' AND shares_outstanding IS NOT NULL AND shares_outstanding < 1e8)

  )

`.trim();



export const SELECT_TARGET_HOLDERS_SQL = `

WITH target AS (

  SELECT

    institution_cik AS cik,

    institution_name AS name,

    institution_type,

    shares,

    ownership_pct

  FROM ownership_holding

  WHERE ticker = UPPER(BTRIM($1::text))

    AND ($2::text = '' OR institution_type = $2)

),

inst_totals AS (

  SELECT

    oh.institution_cik,

    SUM(oh.shares)::float8 AS total_shares

  FROM ownership_holding oh

  INNER JOIN target t ON t.cik = oh.institution_cik

  GROUP BY oh.institution_cik

)

SELECT

  t.cik,

  t.name,

  t.institution_type,

  t.shares,

  t.ownership_pct,

  (t.shares / NULLIF(it.total_shares, 0))::float8 AS portfolio_weight,

  (

    SELECT current_quarter FROM ownership_cache WHERE ticker = UPPER(BTRIM($1::text)) LIMIT 1

  ) AS quarter

FROM target t

LEFT JOIN inst_totals it ON it.institution_cik = t.cik

ORDER BY t.shares DESC

`.trim();



export const SELECT_STOCK_META_SQL = `

SELECT ticker, company_name, sector

FROM stocks

WHERE ticker = UPPER(BTRIM($1::text))

`.trim();



export const SELECT_INSIDER_BUYS_FOR_TICKER_SQL = `

SELECT

  insider_name AS name,

  insider_title AS title,

  COALESCE(transaction_date, filing_date)::text AS transaction_date,

  COALESCE(transaction_value, 0)::float8 AS transaction_value,

  COALESCE(shares, 0)::float8 AS shares

FROM insider_transaction

WHERE UPPER(BTRIM(ticker)) = UPPER(BTRIM($1::text))

  AND NOT is_derivative

  AND (

    UPPER(BTRIM(transaction_code)) = 'P'

    OR UPPER(BTRIM(COALESCE(acquisition_disposition, ''))) = 'A'

  )

  AND COALESCE(transaction_date, filing_date) >= (CURRENT_DATE - ($2::int || ' days')::interval)

ORDER BY COALESCE(transaction_date, filing_date) DESC NULLS LAST

LIMIT $3::int

`.trim();



export const SELECT_SECTORS_SQL = `

SELECT DISTINCT sector

FROM stocks

WHERE sector IS NOT NULL AND BTRIM(sector) <> ''

ORDER BY sector

`.trim();



export const SELECT_INSTITUTION_TYPES_SQL = `

SELECT DISTINCT institution_type AS type

FROM ownership_holding

WHERE institution_type IS NOT NULL AND BTRIM(institution_type) <> ''

ORDER BY institution_type

`.trim();


