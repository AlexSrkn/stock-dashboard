/**
 * Backfill ownership_cache.primary_cusip for tickers missing it.
 * Uses top cached holders' share counts (~250ms/ticker) instead of full-universe issuer scans.
 *
 * Usage: npm run ownership:backfill-primary-cusip
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { normalizeCusip } from "../src/sec/thirteenF/normalizeHoldings.js";
import { SELECT_PRIMARY_CUSIP_BY_TOP_HOLDERS_SQL } from "../src/ownership/queries.js";

loadEnvFile();
const pool = getPool();

await pool.query(`ALTER TABLE ownership_cache ADD COLUMN IF NOT EXISTS primary_cusip CHAR(9)`);

const tickers = await pool.query<{ ticker: string }>(
  `SELECT ticker FROM ownership_cache WHERE primary_cusip IS NULL ORDER BY institution_count DESC`
);

let updated = 0;
let failed = 0;
const t0 = Date.now();

for (const { ticker } of tickers.rows) {
  try {
    const res = await pool.query<{ cusip: string }>(SELECT_PRIMARY_CUSIP_BY_TOP_HOLDERS_SQL, [ticker]);
    const cusip = res.rows[0]?.cusip ? normalizeCusip(String(res.rows[0].cusip).trim()) : "";
    if (!cusip) {
      failed += 1;
      continue;
    }
    await pool.query(`UPDATE ownership_cache SET primary_cusip = $2 WHERE ticker = $1`, [ticker, cusip]);
    updated += 1;
    if (updated % 250 === 0) {
      console.log(`… ${updated}/${tickers.rows.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  } catch (err) {
    failed += 1;
    console.warn(`skip ${ticker}:`, err instanceof Error ? err.message : err);
  }
}

console.log(
  `Backfill done: ${updated} updated, ${failed} skipped/failed, ${tickers.rows.length} total in ${(
    (Date.now() - t0) /
    1000
  ).toFixed(1)}s`
);

await closePool();
