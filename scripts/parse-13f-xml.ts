/**
 * Parse a 13F information table XML file to normalized JSON.
 *
 * Usage: npx tsx scripts/parse-13f-xml.ts table.xml
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse13F } from "../src/sec/thirteenF/parse13F.js";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/parse-13f-xml.ts <path-to.xml>");
    process.exit(1);
  }

  const xml = await fs.readFile(path.resolve(file), "utf8");
  const holdings = parse13F(xml);
  console.log(JSON.stringify({ count: holdings.length, holdings }, null, 2));
}

main().catch((err) => {
  if (err && typeof err === "object" && "code" in err) {
    console.error(`[${(err as { code: string }).code}]`, (err as Error).message);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
