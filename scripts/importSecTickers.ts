/**
 * Import the SEC Company Tickers dataset into the local `stocks` table.
 *
 * Source: https://www.sec.gov/files/company_tickers.json
 *
 * Usage:
 *   npm run import:stocks
 *
 * Safe to run repeatedly — companies are upserted by ticker (no duplicates).
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { importSecTickers } from "../src/services/secImporter.js";

loadEnvFile();

async function main() {
  console.log("Downloading SEC Company Tickers dataset…");
  const started = Date.now();

  const result = await importSecTickers({
    onProgress: ({ upserted, total }) => {
      console.log(`  upserted ${upserted}/${total}…`);
    },
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\nDone in ${seconds}s: ${result.upserted} companies upserted ` +
      `(${result.total} parsed, ${result.batches} batch${result.batches === 1 ? "" : "es"}).`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
