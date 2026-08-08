import { loadEnvFile } from "../src/db/pool.js";
import {
  fetchRecentPoliticianFilings,
  POLITICIANS_RECENT_PATH,
  writePoliticiansRecent,
} from "../src/politicians/recent.js";

loadEnvFile();

const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "10") || 10;
const houseYear = Number(process.argv.find((a) => a.startsWith("--house-year="))?.split("=")[1] ?? String(new Date().getFullYear()));
const refreshParty = process.argv.includes("--refresh-party");
const skipParty = process.argv.includes("--skip-party");
const outPath =
  process.argv.find((a) => a.startsWith("--out="))?.split("=").slice(1).join("=") ?? POLITICIANS_RECENT_PATH;

async function main() {
  console.log(`Fetching newest ${limit} House (year ${houseYear}) + ${limit} Senate PTR filings…`);
  const payload = await fetchRecentPoliticianFilings({
    limit,
    houseYear,
    outPath,
    enrichParty: !skipParty,
    forceRefreshPartyRoster: refreshParty,
  });
  writePoliticiansRecent(payload, outPath);

  console.log(`\nHouse: ${payload.house.length} filing(s), ${payload.house.reduce((n, f) => n + f.tradeCount, 0)} trades`);
  for (const f of payload.house) {
    console.log(`  · ${f.filingDate} ${f.politicianName} (${f.tradeCount} trades)`);
  }

  console.log(`\nSenate: ${payload.senate.length} filing(s), ${payload.senate.reduce((n, f) => n + f.tradeCount, 0)} trades`);
  for (const f of payload.senate) {
    console.log(`  · ${f.filingDate} ${f.politicianName} (${f.tradeCount} trades)`);
  }

  console.log(`\nSaved ${outPath}`);
  console.log("View in app: Politicians tab (served from /api/politicians/recent)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
