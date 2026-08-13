import { loadEnvFile } from "../src/db/pool.js";
import {
  fetchRecentPoliticianFilings,
  POLITICIANS_RECENT_PATH,
  readPoliticiansRecent,
  sinceDateFromExisting,
  writePoliticiansRecent,
} from "../src/politicians/recent.js";

loadEnvFile();

const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "10") || 10;
const houseYear =
  Number(
    process.argv.find((a) => a.startsWith("--house-year="))?.split("=")[1] ??
      String(new Date().getFullYear())
  ) || new Date().getFullYear();
const refreshParty = process.argv.includes("--refresh-party");
const skipParty = process.argv.includes("--skip-party");
const sinceLast = process.argv.includes("--since-last");
const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] || null;
const outPath =
  process.argv.find((a) => a.startsWith("--out="))?.split("=").slice(1).join("=") ??
  POLITICIANS_RECENT_PATH;

async function main() {
  const existing = readPoliticiansRecent(outPath);
  let sinceDate = sinceArg;
  if (sinceLast) {
    sinceDate = sinceDateFromExisting(existing);
    if (!sinceDate) {
      throw new Error(
        `No previous download found at ${outPath}. Run without --since-last first, or pass --since=YYYY-MM-DD.`
      );
    }
  }

  if (sinceDate) {
    console.log(
      `Incremental PTR fetch since ${sinceDate} (House year ${houseYear} + Senate)…`
    );
    console.log(
      `Existing: House ${existing?.house?.length ?? 0}, Senate ${existing?.senate?.length ?? 0} (fetchedAt ${existing?.fetchedAt ?? "n/a"})`
    );
  } else {
    console.log(`Fetching newest ${limit} House (year ${houseYear}) + ${limit} Senate PTR filings…`);
  }

  const payload = await fetchRecentPoliticianFilings({
    limit,
    houseYear,
    sinceDate,
    mergeExisting: Boolean(sinceDate),
    outPath,
    enrichParty: !skipParty,
    forceRefreshPartyRoster: refreshParty,
  });
  writePoliticiansRecent(payload, outPath);

  console.log(
    `\nHouse: ${payload.house.length} filing(s), ${payload.house.reduce((n, f) => n + f.tradeCount, 0)} trades`
  );
  for (const f of payload.house.slice(0, 15)) {
    console.log(`  · ${f.filingDate} ${f.politicianName} (${f.tradeCount} trades)`);
  }
  if (payload.house.length > 15) console.log(`  · … +${payload.house.length - 15} more`);

  console.log(
    `\nSenate: ${payload.senate.length} filing(s), ${payload.senate.reduce((n, f) => n + f.tradeCount, 0)} trades`
  );
  for (const f of payload.senate.slice(0, 15)) {
    console.log(`  · ${f.filingDate} ${f.politicianName} (${f.tradeCount} trades)`);
  }
  if (payload.senate.length > 15) console.log(`  · … +${payload.senate.length - 15} more`);

  const errors = payload.scrapeErrors || [];
  if (errors.length) {
    console.log(`\nScrape failures: ${errors.length}`);
    for (const err of errors.slice(0, 30)) {
      console.log(
        `  · [${err.chamber}] ${err.politicianName} (${err.filingDate || "?"}) — ${err.message}`
      );
    }
    if (errors.length > 30) console.log(`  · … +${errors.length - 30} more`);
  } else {
    console.log("\nNo scrape failures.");
  }

  console.log(`\nSaved ${outPath}`);
  console.log("View in app: Politicians tab (served from /api/politicians/recent)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
