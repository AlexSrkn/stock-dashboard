/**
 * Precompute portfolio-value proxy snapshots for /institutions/performance.
 * Usage: npm run institutions:warm-portfolio-proxy
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { savePortfolioProxySnapshotsToDisk } from "../src/institution/portfolioPerformanceProxy/cache.js";
import { SELECT_PORTFOLIO_VALUE_HISTORY_SQL, trackedInstitutionCiks } from "../src/institution/portfolioPerformanceProxy/queries.js";
import { formatSecCik } from "../src/sec/http.js";
import { reloadTrackedInstitutions } from "../src/ownership/trackedInstitutions.js";

loadEnvFile();
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

reloadTrackedInstitutions(true);
const pool = getPool();
const ciks = trackedInstitutionCiks();
console.log(`Warming portfolio proxy snapshots for ${ciks.length} tracked institutions…`);

const res = await pool.query<{
  institution_id: string;
  quarter: string;
  filing_date: string | null;
  holdings_count: number;
  portfolio_value_usd: string | number;
}>(SELECT_PORTFOLIO_VALUE_HISTORY_SQL, [ciks]);

const snapshots = res.rows.map((r) => ({
  institutionId: formatSecCik(String(r.institution_id)),
  quarter: String(r.quarter),
  filingDate: r.filing_date ? String(r.filing_date) : null,
  holdingsCount: Number(r.holdings_count) || 0,
  portfolioValueUsd: Number(r.portfolio_value_usd) || 0,
}));

if (!snapshots.length) {
  console.error("No portfolio proxy snapshots computed. Existing cache was not overwritten.");
  process.exit(1);
}

savePortfolioProxySnapshotsToDisk(snapshots);
const instCount = new Set(snapshots.map((s) => s.institutionId)).size;
console.log(
  `Portfolio proxy cache saved: ${instCount} institutions, ${snapshots.length} snapshots → data/cache/portfolio-proxy-snapshots.json`
);
await closePool();
