/**
 * Diagnose Market Pulse politician dates vs recent.json equity buys.
 * Usage: npx tsx scripts/diagnose-politician-pulse.ts
 */
import { loadEnvFile } from "../src/db/pool.js";
import { readPoliticiansRecent } from "../src/politicians/recent.js";
import { cleanPoliticianTicker } from "../src/politicians/normalize.js";
import { getRecentlyActiveStocks } from "../src/stocks/recentlyActive.js";

loadEnvFile();

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    return `${us[3]}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  }
  return null;
}

async function main() {
  const payload = readPoliticiansRecent();
  if (!payload) {
    console.error("No data/politicians/recent.json found");
    process.exit(1);
  }

  console.log("recent.json fetchedAt:", payload.fetchedAt);
  console.log("filings: House", payload.house.length, "Senate", payload.senate.length);

  const buys: Array<{ filingDate: string; ticker: string; name: string; type: string }> = [];
  for (const bundle of [...payload.house, ...payload.senate]) {
    for (const trade of bundle.trades || []) {
      const ticker =
        cleanPoliticianTicker(trade.ticker || "") ||
        cleanPoliticianTicker(trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i)?.[1] || "");
      const filingDate = toIsoDate(trade.filingDate || bundle.filingDate || trade.notificationDate);
      if (!ticker || !filingDate) continue;
      if (trade.transactionCategory !== "buy") continue;
      buys.push({
        filingDate,
        ticker,
        name: String(trade.politicianName || bundle.politicianName || "?"),
        type: String(trade.transactionType || ""),
      });
    }
  }
  buys.sort((a, b) => b.filingDate.localeCompare(a.filingDate) || a.ticker.localeCompare(b.ticker));

  console.log("\nequity buys with ticker:", buys.length);
  console.log("latest 20 from recent.json:");
  for (const row of buys.slice(0, 20)) {
    console.log(`  ${row.filingDate}  ${row.ticker.padEnd(6)}  ${row.name}  (${row.type})`);
  }

  const url = new URL("http://localhost/api/stocks/recently-active?source=politician");
  const api = await getRecentlyActiveStocks(url);
  console.log("\nrecently-active API (politician) top days:");
  for (const day of api.days.slice(0, 8)) {
    const buyTickers = day.stocks
      .filter((s) => s.items.some((i) => /disclosed a purchase/i.test(i.action)))
      .map((s) => s.ticker);
    console.log(`  ${day.date}  stocks=${day.stocks.length}  buyTickers=${buyTickers.slice(0, 8).join(",")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
