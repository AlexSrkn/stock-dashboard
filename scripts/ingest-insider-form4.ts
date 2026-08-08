/**
 * Ingest Form 4 / 4/A insider transactions for a ticker into Postgres.
 *
 * Usage:
 *   npx tsx scripts/ingest-insider-form4.ts AAPL
 *   npx tsx scripts/ingest-insider-form4.ts AAPL --limit 80
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { ingestForm4ForTicker } from "../src/sec/form4/ingestForm4.js";

loadEnvFile();

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ticker = args[0];
if (!ticker) {
  console.error("Usage: npx tsx scripts/ingest-insider-form4.ts <TICKER> [--limit N]");
  process.exit(1);
}

let limit = 40;
const limitIdx = process.argv.indexOf("--limit");
if (limitIdx !== -1 && process.argv[limitIdx + 1]) {
  limit = Math.max(1, Number(process.argv[limitIdx + 1]) || 40);
}

const result = await ingestForm4ForTicker({ ticker, limit });
console.log(JSON.stringify(result, null, 2));
if (result.errors.length) {
  console.warn(`Warnings: ${result.errors.length} filing(s) failed`);
  for (const e of result.errors.slice(0, 5)) console.warn(" ", e);
}
await closePool();
