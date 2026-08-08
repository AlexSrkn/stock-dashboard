/**
 * Download raw 13F information table XML for the latest filing of a filer CIK.
 *
 * Usage: npx tsx scripts/download-13f-xml.ts 1067983 [--out table.xml]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { downloadLatest13FInfoTableXml } from "../src/sec/thirteenF/downloadInfoTable.js";

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const cik = args.find((a) => a !== "--out" && (outIdx < 0 || a !== outPath));

  if (!cik) {
    console.error("Usage: npx tsx scripts/download-13f-xml.ts <CIK> [--out file.xml]");
    process.exit(1);
  }

  const result = await downloadLatest13FInfoTableXml({
    cik,
    maxAttempts: 3,
    onRetry: ({ attempt, delayMs, error }) => {
      console.error(
        `Retry ${attempt} in ${delayMs}ms:`,
        error instanceof Error ? error.message : error
      );
    },
  });

  if (outPath) {
    await fs.writeFile(path.resolve(outPath), result.xml, "utf8");
    console.error(
      `Wrote ${path.resolve(outPath)} (${result.xml.length} bytes, ${result.documentName})`
    );
  } else {
    process.stdout.write(result.xml);
  }
}

main().catch((err) => {
  if (err && typeof err === "object" && "code" in err) {
    console.error(`[${(err as { code: string }).code}]`, (err as Error).message);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
