import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "../src/db/pool.js";
import type { PoliticianTrade } from "../src/politicians/types.js";
import { SenateEfdClient } from "../src/politicians/senate/efdClient.js";

loadEnvFile();

const fromDate = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1];
const toDate = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1];
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0") || undefined;
const listOnly = process.argv.includes("--list-only");
const outDir =
  process.argv.find((a) => a.startsWith("--out="))?.split("=").slice(1).join("=") ??
  join("data", "senate-ptr");

async function main() {
  const client = new SenateEfdClient();

  console.log("Discovering Senate PTR filings…");
  const filings = await client.listAllPtrFilings({
    fromDate,
    toDate,
    limit,
    htmlOnly: true,
  });
  console.log(`Found ${filings.length} HTML PTR filing(s)`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "filings.json"), JSON.stringify(filings, null, 2));

  if (listOnly) {
    for (const f of filings.slice(0, 20)) {
      console.log(`${f.reportDate} · ${f.firstName} ${f.lastName} · ${f.reportUrl}`);
    }
    if (filings.length > 20) console.log(`… and ${filings.length - 20} more (see ${outDir}/filings.json)`);
    return;
  }

  const allTrades: PoliticianTrade[] = [];
  let ok = 0;
  let failed = 0;

  for (const [i, filing] of filings.entries()) {
    const label = `${filing.firstName} ${filing.lastName}`.trim();
    process.stdout.write(`[${i + 1}/${filings.length}] ${label} … `);
    try {
      const trades = await client.fetchPtrTrades(filing);
      allTrades.push(...trades);
      ok += 1;
      console.log(`${trades.length} trade(s)`);
    } catch (err) {
      failed += 1;
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  writeFileSync(join(outDir, "trades.json"), JSON.stringify(allTrades, null, 2));
  console.log(`\nDone: ${ok} filings parsed, ${failed} failed, ${allTrades.length} total trades`);
  console.log(`Output: ${outDir}/filings.json, ${outDir}/trades.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
