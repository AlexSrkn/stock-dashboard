/**

 * Precompute hidden gems cache.

 * Usage: npm run signals:warm-hidden-gems

 */

import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";

import { computeHiddenGems } from "../src/signals/hiddenGems/compute.js";

import { saveHiddenGemsToDisk } from "../src/signals/hiddenGems/cache.js";



loadEnvFile();



const pool = getPool();

console.log("Computing hidden gems…");

const t0 = Date.now();

try {

  const payload = await computeHiddenGems(pool);

  saveHiddenGemsToDisk(payload);

  console.log(

    `Saved ${payload.signals.length} gems · latest ${payload.currentQuarter}` +

      (payload.previousQuarter ? ` vs ${payload.previousQuarter}` : "") +

      ` · ${Date.now() - t0}ms`

  );

  console.log(

    `  emerging=${payload.summary.emerging}` +

      ` hiddenGem=${payload.summary.hiddenGem}` +

      ` strong=${payload.summary.strongAccumulation}` +

      ` discovery=${payload.summary.institutionalDiscovery}`

  );

} catch (err) {

  console.error(err instanceof Error ? err.message : err);

  process.exitCode = 1;

} finally {

  await closePool();

}


