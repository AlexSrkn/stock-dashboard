import { loadEnvFile } from "../src/db/pool.js";
import {
  fetchHousePtrTradesFromPdfUrl,
  sampleHousePtrTrades,
  summarizeHouseFiling,
} from "../src/politicians/house/fetchHouse.js";
import { SenateEfdClient, fetchSenatePtrTradesFromUrl } from "../src/politicians/senate/efdClient.js";

loadEnvFile();

const year = Number(process.argv.find((a) => a.startsWith("--year="))?.split("=")[1] ?? "2026");
const houseLimit = Number(process.argv.find((a) => a.startsWith("--house-limit="))?.split("=")[1] ?? "3");
const housePdfUrl =
  process.argv.find((a) => a.startsWith("--house-pdf="))?.split("=").slice(1).join("=") ??
  "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2024/20025819.pdf";
const senateFrom = process.argv.find((a) => a.startsWith("--senate-from="))?.split("=")[1] ?? "06/01/2026";
const senateTo = process.argv.find((a) => a.startsWith("--senate-to="))?.split("=")[1] ?? "06/15/2026";
const senateLimit = Number(process.argv.find((a) => a.startsWith("--senate-limit="))?.split("=")[1] ?? "3");
const senatePtrUrl =
  process.argv.find((a) => a.startsWith("--senate-ptr="))?.split("=").slice(1).join("=") ??
  "https://efdsearch.senate.gov/search/view/ptr/727b4eb6-d8c7-4792-aa5b-c651c2d72f9c/";

function logTrade(trade: {
  transactionDate: string | null;
  transactionType: string;
  ticker: string | null;
  assetName: string;
  amountRange: string | null;
  ownerDetail?: string | null;
  filingStatus?: string | null;
  comment?: string | null;
}) {
  const label = trade.ticker ?? trade.assetName;
  const meta = [
    trade.filingStatus ? `status=${trade.filingStatus}` : null,
    trade.ownerDetail ? `owner=${trade.ownerDetail}` : null,
    trade.comment ? `desc=${trade.comment.slice(0, 60)}${trade.comment.length > 60 ? "…" : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  console.log(
    `  - ${trade.transactionDate} ${trade.transactionType} ${label} ${trade.amountRange}${meta ? ` (${meta})` : ""}`
  );
}

async function main() {
  console.log(`\n=== House PTR direct PDF ===\n${housePdfUrl}`);
  try {
    const directTrades = await fetchHousePtrTradesFromPdfUrl(housePdfUrl);
    console.log(`Parsed ${directTrades.length} transaction(s) from PDF`);
    for (const trade of directTrades.slice(0, 5)) logTrade(trade);
  } catch (err) {
    console.error("House direct PDF failed:", err instanceof Error ? err.message : String(err));
  }

  console.log(`\n=== House PTR sample (${year}, first ${houseLimit} filings from index) ===`);
  const houseSamples = await sampleHousePtrTrades({ year, limit: houseLimit });
  for (const sample of houseSamples) {
    console.log("\nFiling:", summarizeHouseFiling(sample.filing));
    console.log(`Parsed ${sample.trades.length} transaction(s)`);
    for (const trade of sample.trades.slice(0, 5)) logTrade(trade);
  }

  console.log(`\n=== Senate PTR direct URL ===\n${senatePtrUrl}`);
  try {
    const directTrades = await fetchSenatePtrTradesFromUrl(senatePtrUrl);
    console.log(`Parsed ${directTrades.length} transaction(s) from PTR page`);
    if (directTrades[0]) {
      console.log("Filer:", directTrades[0].politicianName, "· filed", directTrades[0].filingDate);
    }
    for (const trade of directTrades.slice(0, 5)) logTrade(trade);
  } catch (err) {
    console.error("Senate direct PTR failed:", err instanceof Error ? err.message : String(err));
  }

  console.log(`\n=== Senate PTR search (${senateFrom} – ${senateTo}, first ${senateLimit} filings) ===`);
  try {
    const senate = new SenateEfdClient();
    const filings = await senate.searchPtrFilings({
      fromDate: senateFrom,
      toDate: senateTo,
      limit: senateLimit,
    });
    console.log(`Found ${filings.length} PTR filing(s)`);
    for (const filing of filings.slice(0, senateLimit)) {
      console.log("\nFiling:", {
        name: `${filing.firstName} ${filing.lastName}`.trim(),
        office: filing.office,
        reportType: filing.reportType,
        url: filing.reportUrl,
      });
      const trades = await senate.fetchPtrTrades(filing);
      console.log(`Parsed ${trades.length} transaction(s)`);
      for (const trade of trades.slice(0, 5)) logTrade(trade);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Senate scrape failed:", msg);
    console.error(
      "Note: Senate search API may return 503 while direct PTR view URLs still work (use --senate-ptr=)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
