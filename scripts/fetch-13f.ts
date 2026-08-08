/**
 * Fetch 13F-HR filings for an institutional filer CIK, parse info tables, emit JSON.
 *
 * Usage:
 *   npx tsx scripts/fetch-13f.ts 1067983
 *   npx tsx scripts/fetch-13f.ts BRK.A --limit 2 --out berkshire-13f.json
 *
 * Note: pass the filer (manager) CIK, not the stock issuer CIK.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { lookupCikFromTicker } from "../src/sec/submissions.js";
import { fetchAndNormalize13FFilings } from "../src/sec/thirteenF/pipeline.js";

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const outIdx = args.indexOf("--out");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 1 : 1;
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const positional = args.filter(
    (a, i) =>
      a !== "--limit" &&
      a !== "--out" &&
      (limitIdx < 0 || i !== limitIdx + 1) &&
      (outIdx < 0 || i !== outIdx + 1)
  );
  const input = positional[0];

  if (!input) {
    console.error("Usage: npx tsx scripts/fetch-13f.ts <FILER_CIK|TICKER> [--limit N] [--out file.json]");
    process.exit(1);
  }

  const filerCik = /^\d+$/.test(input.replace(/\D/g, ""))
    ? input.replace(/\D/g, "")
    : String(await lookupCikFromTicker(input));

  const results = await fetchAndNormalize13FFilings({ filerCik, limit });
  const payload = {
    filerCik: results[0]?.filing.filerCik ?? filerCik.padStart(10, "0"),
    filingsProcessed: results.length,
    results,
  };

  const json = JSON.stringify(payload, null, 2);
  if (outPath) {
    await fs.writeFile(path.resolve(outPath), json, "utf8");
    console.log(`Wrote ${path.resolve(outPath)} (${results.length} filing(s))`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
