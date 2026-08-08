import { loadEnvFile } from "../src/db/pool.js";
import { fetchPartyRosterFromSource } from "../src/politicians/enrichment/party/roster.js";

loadEnvFile();

async function main() {
  console.log("Refreshing congressional party roster cache…");
  const index = await fetchPartyRosterFromSource();
  const house = index.byChamber.get("house")?.length ?? 0;
  const senate = index.byChamber.get("senate")?.length ?? 0;
  console.log(`Cached ${house} House + ${senate} Senate members (${index.fetchedAt.slice(0, 10)}).`);
  console.log(`Source: ${index.source}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
