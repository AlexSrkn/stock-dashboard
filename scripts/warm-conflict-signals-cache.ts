/**

 * Precompute conflict signals cache.

 * Usage: npm run signals:warm-conflict-signals

 */

import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";

import { computeConflictSignals } from "../src/signals/conflictSignals/compute.js";

import { saveConflictSignalsToDisk } from "../src/signals/conflictSignals/cache.js";



loadEnvFile();



const pool = getPool();

console.log("Computing conflict signals…");

const t0 = Date.now();

try {

  const payload = await computeConflictSignals(pool);

  saveConflictSignalsToDisk(payload);

  console.log(

    `Saved ${payload.signals.length} signals · quarter ${payload.currentQuarter}` +

      (payload.previousQuarter ? ` vs ${payload.previousQuarter}` : "") +

      ` · ${Date.now() - t0}ms`

  );

  console.log(

    `  bullish=${payload.summary.bullishConflicts}` +

      ` bearish=${payload.summary.bearishConflicts}` +

      ` divergence=${payload.summary.strongDivergences}` +

      ` doubleConviction=${payload.summary.doubleConviction}`

  );

} catch (err) {

  console.error(err instanceof Error ? err.message : err);

  process.exitCode = 1;

} finally {

  await closePool();

}


