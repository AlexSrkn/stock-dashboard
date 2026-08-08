/**
 * CLI: download SEC submissions JSON for a ticker or CIK.
 *
 * Usage:
 *   npx tsx scripts/download-sec-submissions.ts AAPL
 *   npx tsx scripts/download-sec-submissions.ts 320193 --out apple-submissions.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  downloadSecSubmissionsByTicker,
  downloadSecSubmissionsJson,
  formatSecCik,
} from "../src/secSubmissions.js";

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const positional = args.filter((a, i) => a !== "--out" && (outIdx < 0 || i !== outIdx + 1));
  const input = positional[0];

  if (!input) {
    console.error("Usage: npx tsx scripts/download-sec-submissions.ts <TICKER|CIK> [--out file.json]");
    process.exit(1);
  }

  const isCik = /^\d+$/.test(input.replace(/\D/g, ""));
  const data = isCik
    ? await downloadSecSubmissionsJson({ cik: input })
    : await downloadSecSubmissionsByTicker({ ticker: input });

  const json = JSON.stringify(data, null, 2);
  if (outPath) {
    await fs.writeFile(path.resolve(outPath), json, "utf8");
    console.log(`Wrote ${path.resolve(outPath)} (CIK ${formatSecCik(data.cik)})`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
