/**
 * Report 13F ingestion coverage vs curated institutional filers.
 * Usage: npx tsx scripts/audit-13f-coverage.ts
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { TRACKED_INSTITUTIONAL_MANAGERS } from "../src/ownership/trackedInstitutions.js";
import { paddedInstitutionalCik } from "../src/ownership/trackedInstitutions.js";

loadEnvFile();

async function main() {
  const pool = getPool();

  const totals = await pool.query<{
    filings: string;
    filers: string;
    holdings: string;
    quarters: string;
    latest_quarter: string | null;
    latest_filing_date: string | null;
    total_value_sum: string | null;
  }>(`
    SELECT
      COUNT(DISTINCT f.id)::text AS filings,
      COUNT(DISTINCT f.filer_cik)::text AS filers,
      (SELECT COUNT(*)::text FROM sec_holding) AS holdings,
      COUNT(DISTINCT f.quarter)::text AS quarters,
      MAX(f.quarter) AS latest_quarter,
      MAX(f.filing_date)::text AS latest_filing_date,
      SUM(COALESCE(f.total_value, 0))::text AS total_value_sum
    FROM sec_filing f
  `);

  const byFiler = await pool.query<{
    filer_cik: string;
    fund_name: string;
    filing_count: string;
    latest_quarter: string | null;
    latest_filing_date: string | null;
    holdings_count: string;
  }>(`
    SELECT
      f.filer_cik,
      MAX(f.fund_name) AS fund_name,
      COUNT(DISTINCT f.id)::text AS filing_count,
      MAX(f.quarter) AS latest_quarter,
      MAX(f.filing_date)::text AS latest_filing_date,
      COUNT(h.id)::text AS holdings_count
    FROM sec_filing f
    LEFT JOIN sec_holding h ON h.filing_id = f.id
    GROUP BY f.filer_cik
    ORDER BY f.filer_cik
  `);

  const ingestedCiks = new Set(byFiler.rows.map((r) => r.filer_cik));
  const tracked = TRACKED_INSTITUTIONAL_MANAGERS.map((m) => ({
    name: m.name,
    cik: paddedInstitutionalCik(m.cik),
  }));

  const missing = tracked.filter((m) => !ingestedCiks.has(m.cik));
  const extra = byFiler.rows.filter(
    (r) => !tracked.some((m) => m.cik === r.filer_cik)
  );

  const t = totals.rows[0];
  console.log("=== 13F database coverage ===\n");
  console.log(`Tracked institutional filers (seed list): ${tracked.length}`);
  console.log(`Filers with at least one filing in DB:     ${byFiler.rows.length}`);
  console.log(`Total filings ingested:                  ${t?.filings ?? "0"}`);
  console.log(`Distinct quarters in DB:                  ${t?.quarters ?? "0"}`);
  console.log(`Latest quarter (any filer):                ${t?.latest_quarter ?? "—"}`);
  console.log(`Latest filing date:                        ${t?.latest_filing_date ?? "—"}`);
  console.log(`Total holding rows:                        ${t?.holdings ?? "0"}`);

  console.log("\n--- Per filer (ingested) ---");
  for (const row of byFiler.rows) {
    const label = tracked.find((m) => m.cik === row.filer_cik)?.name ?? row.fund_name;
    console.log(
      `  ${label}: ${row.filing_count} filing(s), quarter ${row.latest_quarter ?? "—"}, ` +
        `filed ${row.latest_filing_date ?? "—"}, ${row.holdings_count} holdings rows`
    );
  }

  if (missing.length) {
    console.log(`\n--- Missing from DB (${missing.length} tracked filers) ---`);
    for (const m of missing) {
      console.log(`  ${m.name} (CIK ${m.cik})`);
    }
  } else {
    console.log("\nAll tracked filers have at least one filing in the DB.");
  }

  if (extra.length) {
    console.log(`\n--- In DB but not in seed list (${extra.length}) ---`);
    for (const row of extra) {
      console.log(`  ${row.fund_name} (CIK ${row.filer_cik})`);
    }
  }

  const multiQuarter = byFiler.rows.filter((r) => Number(r.filing_count) > 1);
  const avgFilings =
    byFiler.rows.length > 0
      ? (byFiler.rows.reduce((s, r) => s + Number(r.filing_count), 0) / byFiler.rows.length).toFixed(1)
      : "0";
  console.log(`\nAverage filings per filer: ${avgFilings} (target: up to 8 recent 13F-HR/A per CIK)`);
  if (multiQuarter.length) {
    console.log(`Filers with multiple filings: ${multiQuarter.length}`);
  } else {
    console.log("Note: Each filer has only one filing — run ingest with --filings 8 to backfill history.");
  }

  const optionRows = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM sec_holding
    WHERE COALESCE(option_type, put_call) IS NOT NULL AND btrim(COALESCE(option_type, put_call, '')) <> ''
  `);
  const stockRows = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM sec_holding
    WHERE (COALESCE(option_type, put_call) IS NULL OR btrim(COALESCE(option_type, put_call, '')) = '')
      AND upper(btrim(COALESCE(security_type, shares_type, 'SH'))) = 'SH'
  `);
  console.log(`\nHoldings breakdown: ${stockRows.rows[0]?.n ?? 0} common-stock rows, ${optionRows.rows[0]?.n ?? 0} put/call rows (stored separately).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
