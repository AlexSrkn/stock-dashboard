/**
 * Scrape the complete 13f.info managers directory into a candidate universe.
 *
 * Example:
 *   npm run sec:scrape-13f-info-managers
 *   npm run sec:scrape-13f-info-managers -- --minimum-quarter=2026-Q1
 *   npm run sec:scrape-13f-info-managers -- --letters=a,b --force-refresh
 *   npm run sec:scrape-13f-info-managers -- --enrich-dates --enrich-dates-limit=50
 *   npm run sec:scrape-13f-info-managers -- --write-db
 *
 * Does NOT query SEC EDGAR, download 13F XML, resolve CIKs, or touch performance code.
 */
import { join } from "node:path";
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { upsertThirteenFManagerCandidates } from "../src/sec/thirteenFInfo/candidatesDb.js";
import {
  DEFAULT_MINIMUM_QUARTER,
  scrapeThirteenFInfoManagers,
} from "../src/sec/thirteenFInfo/scrapeManagers.js";
import {
  printScrapeSummary,
  writeThirteenFInfoOutputs,
} from "../src/sec/thirteenFInfo/writeOutputs.js";

loadEnvFile();

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

async function main() {
  const minimumQuarter = argValue("--minimum-quarter") || DEFAULT_MINIMUM_QUARTER;
  const outDir =
    argValue("--out") || join("data", "13f-info");
  const delayMs = Number(argValue("--delay-ms") ?? "400") || 400;
  const forceRefresh = process.argv.includes("--force-refresh");
  const enrichDates = process.argv.includes("--enrich-dates");
  const enrichDatesLimit = Number(argValue("--enrich-dates-limit") ?? "0") || 0;
  const writeDb = process.argv.includes("--write-db");
  const lettersRaw = argValue("--letters");
  const letters = lettersRaw
    ? lettersRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : undefined;

  console.log("13f.info managers candidate scrape");
  console.log(`  minimum_quarter = ${minimumQuarter}`);
  console.log(`  out             = ${outDir}`);
  console.log(`  delay_ms        = ${delayMs}`);
  console.log(`  force_refresh   = ${forceRefresh}`);
  console.log(`  enrich_dates    = ${enrichDates}`);
  if (letters?.length) console.log(`  letters         = ${letters.join(",")}`);

  const result = await scrapeThirteenFInfoManagers({
    minimumQuarter,
    outDir,
    delayMs,
    forceRefresh,
    letters,
    enrichDates,
    enrichDatesLimit,
  });

  const paths = writeThirteenFInfoOutputs(result, outDir);
  printScrapeSummary(result);
  console.log(`\nWrote:\n  ${paths.jsonPath}\n  ${paths.csvPath}\n  ${paths.allJsonPath}`);

  if (writeDb) {
    try {
      const n = await upsertThirteenFManagerCandidates(result.candidates, {
        minimumQuarter: result.minimumQuarter,
        scrapedAt: result.scrapedAt,
      });
      console.log(`Wrote ${n} rows to staging table thirteen_f_manager_candidates`);
    } catch (err) {
      console.error(
        `DB write failed (JSON/CSV still saved): ${err instanceof Error ? err.message : String(err)}`
      );
      process.exitCode = 1;
    } finally {
      await closePool().catch(() => {});
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => {});
  process.exit(1);
});
