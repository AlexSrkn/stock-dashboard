/**
 * Debug Two Sigma QoQ: Q1 2026 vs Q4 2025 common-stock shares (latest filing per quarter).
 * Usage: npx tsx scripts/debug-two-sigma-qoq.ts [TICKER]
 */
import { loadEnvFile, getPool, closePool } from "../src/db/pool.js";
import {
  CTE_LATEST_FILINGS,
  sqlCommonStockOnly,
} from "../src/ownership/queries.js";
import { paddedInstitutionalCik } from "../src/ownership/trackedInstitutions.js";
import { resolveStockIdentifiers } from "../src/ownership/resolveStock.js";

loadEnvFile();

const TWO_SIGMA_CIK = paddedInstitutionalCik("1179392");
const QUARTERS = ["2026-Q1", "2025-Q4"];

async function main() {
  const ticker = (process.argv[2] || "").trim().toUpperCase();
  const pool = getPool();

  if (ticker) {
    const stock = await resolveStockIdentifiers(pool, ticker);
    console.log(`\n=== Two Sigma — ${ticker} (CUSIPs: ${stock.cusips.join(", ")}) ===\n`);
    await printForCusips(pool, stock.cusips, ticker);
  } else {
    console.log("\n=== Two Sigma — all positions ~5.9M shares in 2026-Q1 ===\n");
    const big = await pool.query<{ cusip: string; issuer: string; shares: string; quarter: string }>(
      `
      WITH ${CTE_LATEST_FILINGS}
      SELECT h.cusip, MAX(h.issuer) AS issuer, h.quarter,
             SUM(h.shares)::text AS shares
      FROM sec_holding h
      INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
      WHERE h.filer_cik = $1
        AND h.quarter = '2026-Q1'
        ${sqlCommonStockOnly("h")}
      GROUP BY h.cusip, h.quarter
      HAVING SUM(h.shares) BETWEEN 5900000 AND 6000000
      ORDER BY SUM(h.shares) DESC
      `,
      [TWO_SIGMA_CIK]
    );
    if (!big.rows.length) {
      console.log("No 2026-Q1 position with ~5.9M shares. Listing top 2026-Q1 positions:\n");
      const top = await pool.query(
        `
        WITH ${CTE_LATEST_FILINGS}
        SELECT h.cusip, MAX(h.issuer) AS issuer, SUM(h.shares)::float8 AS shares
        FROM sec_holding h
        INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
        WHERE h.filer_cik = $1 AND h.quarter = '2026-Q1' ${sqlCommonStockOnly("h")}
        GROUP BY h.cusip ORDER BY shares DESC LIMIT 15
        `,
        [TWO_SIGMA_CIK]
      );
      console.table(top.rows);
      return;
    }
    for (const row of big.rows) {
      console.log(`Issuer: ${row.issuer}  CUSIP: ${row.cusip}  Q1 shares: ${row.shares}`);
      await printForCusips(pool, [row.cusip], row.issuer);
    }
  }
}

async function printForCusips(pool: ReturnType<typeof getPool>, cusips: string[], label: string) {
  const filingDetail = await pool.query(
    `
    SELECT id, accession_number, quarter, filing_date, report_period, holdings_count
    FROM sec_filing
    WHERE filer_cik = $1 AND quarter = ANY($2::text[])
    ORDER BY quarter DESC, filing_date DESC
    `,
    [TWO_SIGMA_CIK, QUARTERS]
  );
  console.log("\n--- Filings on file (all; * = used if latest by filing_date) ---");
  const latestByQ = new Map<string, { id: number; filing_date: string }>();
  for (const f of filingDetail.rows) {
    const q = String(f.quarter);
    if (!latestByQ.has(q)) latestByQ.set(q, { id: Number(f.id), filing_date: String(f.filing_date) });
  }
  for (const f of filingDetail.rows) {
    const q = String(f.quarter);
    const isLatest = latestByQ.get(q)?.id === Number(f.id);
    console.log(
      `  ${isLatest ? "*" : " "} ${q}  ${f.filing_date}  ${f.accession_number}  holdings_count=${f.holdings_count}`
    );
  }

  const byQuarter = await pool.query<{
    quarter: string;
    filing_id: string;
    filing_date: string;
    accession_number: string;
    total_sh: string;
    line_count: string;
  }>(
    `
    WITH ${CTE_LATEST_FILINGS}
    SELECT
      h.quarter,
      lf.filing_id::text,
      f.filing_date::text,
      f.accession_number,
      SUM(h.shares)::text AS total_sh,
      COUNT(*)::text AS line_count
    FROM sec_holding h
    INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
    INNER JOIN sec_filing f ON f.id = lf.filing_id
    WHERE h.filer_cik = $1
      AND h.cusip = ANY($2::bpchar[])
      AND h.quarter = ANY($3::text[])
      ${sqlCommonStockOnly("h")}
    GROUP BY h.quarter, lf.filing_id, f.filing_date, f.accession_number
    ORDER BY h.quarter DESC
    `,
    [TWO_SIGMA_CIK, cusips, QUARTERS]
  );

  console.log("\n--- Aggregated common stock (latest filing per quarter) ---");
  console.table(byQuarter.rows);

  const lines = await pool.query(
    `
    WITH ${CTE_LATEST_FILINGS}
    SELECT h.quarter, h.cusip, h.issuer, h.shares, h.title_of_class,
           COALESCE(h.option_type, h.put_call) AS option_type,
           COALESCE(h.security_type, h.shares_type) AS security_type,
           f.accession_number
    FROM sec_holding h
    INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
    INNER JOIN sec_filing f ON f.id = lf.filing_id
    WHERE h.filer_cik = $1
      AND h.cusip = ANY($2::bpchar[])
      AND h.quarter = ANY($3::text[])
      ${sqlCommonStockOnly("h")}
    ORDER BY h.quarter DESC, h.shares DESC
    `,
    [TWO_SIGMA_CIK, cusips, QUARTERS]
  );
  console.log("\n--- Line items (common stock only) ---");
  console.table(lines.rows);

  const q1 = byQuarter.rows.find((r) => r.quarter === "2026-Q1");
  const q4 = byQuarter.rows.find((r) => r.quarter === "2025-Q4");
  const cur = q1 ? Number(q1.total_sh) : null;
  const prev = q4 ? Number(q4.total_sh) : null;
  if (cur != null && prev != null && prev > 0) {
    const pct = Math.round(((cur - prev) / prev) * 10000) / 100;
    console.log(`\n--- QoQ math (${label}) ---`);
    console.log(`  Q4 2025 shares: ${prev.toLocaleString()}`);
    console.log(`  Q1 2026 shares: ${cur.toLocaleString()}`);
    console.log(`  Change:         ${(cur - prev).toLocaleString()}`);
    console.log(`  QoQ %:          ${pct >= 0 ? "+" : ""}${pct}%`);
  } else {
    console.log("\n(Missing one quarter — cannot compute QoQ)");
  }

  const withoutLatestFilter = await pool.query(
    `
    SELECT h.quarter, f.accession_number, f.filing_date::text,
           SUM(h.shares)::float8 AS total_sh, COUNT(*)::int AS lines
    FROM sec_holding h
    JOIN sec_filing f ON f.id = h.filing_id
    WHERE h.filer_cik = $1 AND h.cusip = ANY($2::bpchar[]) AND h.quarter = ANY($3::text[])
      ${sqlCommonStockOnly("h")}
    GROUP BY h.quarter, f.id, f.accession_number, f.filing_date
    ORDER BY h.quarter DESC, f.filing_date DESC
    `,
    [TWO_SIGMA_CIK, cusips, QUARTERS]
  );
  if (withoutLatestFilter.rows.length > (byQuarter.rows.length || 0)) {
    console.log("\n--- WARNING: multiple filings per quarter (if summed = double count) ---");
    console.table(withoutLatestFilter.rows);
  }

  const filingMeta = await pool.query(
    `SELECT id, filer_cik, fund_name, accession_number, quarter, filing_date, report_period
     FROM sec_filing WHERE filer_cik = $1 AND quarter = ANY($2::text[]) ORDER BY quarter DESC, filing_date DESC`,
    [TWO_SIGMA_CIK, QUARTERS]
  );
  console.log("\n--- sec_filing rows for Two Sigma CIK 0001179392 ---");
  console.table(filingMeta.rows);

  const allLines = await pool.query(
    `
    WITH ${CTE_LATEST_FILINGS}
    SELECT h.quarter, h.shares, h.title_of_class,
           COALESCE(h.option_type, h.put_call) AS option_type,
           COALESCE(h.security_type, h.shares_type) AS security_type
    FROM sec_holding h
    INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id
    WHERE h.filer_cik = $1 AND h.cusip = ANY($2::bpchar[]) AND h.quarter = ANY($3::text[])
    ORDER BY h.quarter DESC, option_type NULLS FIRST
    `,
    [TWO_SIGMA_CIK, cusips, QUARTERS]
  );
  console.log("\n--- All line types (incl. puts/calls) in latest filings ---");
  console.table(allLines.rows);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => closePool());
