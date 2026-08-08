/**
 * Diagnose why institution performance rankings may be empty.
 * Usage: npx tsx scripts/debug-performance-pipeline.ts
 */
import { loadEnvFile, getPool, closePool } from "../src/db/pool.js";
import { loadInstitutionHoldings } from "../src/institution/performance/performanceService.js";
import { getInstitutionPerformanceService } from "../src/institution/performance/index.js";
import { SELECT_INSTITUTION_HOLDINGS_BATCH_SQL } from "../src/institution/performance/queries.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../src/ownership/trackedInstitutions.js";
import { formatSecCik } from "../src/sec/http.js";

loadEnvFile();

async function main() {
  const pool = getPool();
  const ciks = TRACKED_INSTITUTIONAL_CIK_PADDED.map((c) => formatSecCik(c));

  const filings = await pool.query<{ filings: number; filers: number; quarters: number }>(`
    SELECT
      COUNT(*)::int AS filings,
      COUNT(DISTINCT filer_cik)::int AS filers,
      COUNT(DISTINCT quarter)::int AS quarters
    FROM sec_filing
  `);
  console.log("sec_filing:", filings.rows[0]);

  const holdingsAll = await pool.query<{ total: number; with_ticker: number }>(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ticker IS NOT NULL AND btrim(ticker) <> '')::int AS with_ticker
    FROM sec_holding
  `);
  console.log("sec_holding (all rows):", holdingsAll.rows[0]);

  const perfRows = await pool.query(SELECT_INSTITUTION_HOLDINGS_BATCH_SQL, [ciks]);
  console.log("performance SQL rows:", perfRows.rowCount);

  const holdings = await loadInstitutionHoldings(pool);
  console.log("mapped performance holdings:", holdings.length);
  if (holdings.length) {
    const tickers = new Set(holdings.map((h) => h.ticker));
    const quarters = new Set(holdings.map((h) => h.quarter));
    const insts = new Set(holdings.map((h) => h.institutionId));
    console.log({ institutions: insts.size, quarters: quarters.size, tickers: tickers.size });
  } else {
    console.log("No holdings after ticker enrichment — check issuer names / SEC mapping.");
    process.exit(0);
  }

  const runCompute = process.argv.includes("--compute");
  if (!runCompute) {
    console.log("\nHoldings pipeline OK. Re-run with --compute to test Yahoo price + summaries.");
    return;
  }

  console.log("\nComputing performance (may take a while — Yahoo prices)…");
  const service = getInstitutionPerformanceService();
  const summaries = await service.computePerformance();
  console.log("summaries:", summaries.length);
  const withRolling = summaries.filter((s) => s.rolling1yReturn != null);
  const withQoq = summaries.filter((s) => s.qoqReturn != null);
  console.log({ withQoq: withQoq.length, withRolling1y: withRolling.length });

  if (summaries.length) {
    const latest = summaries.slice(-5);
    console.log("\nSample rows:");
    for (const row of latest) {
      console.log(
        `  ${row.institutionId} ${row.quarter} qoq=${row.qoqReturn} rolling1y=${row.rolling1yReturn}`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => closePool());
