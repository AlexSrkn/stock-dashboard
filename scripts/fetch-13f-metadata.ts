/**
 * Print latest 13F filing metadata for a filer CIK.
 *
 * Usage: npx tsx scripts/fetch-13f-metadata.ts 1067983
 */
import { fetch13FOrThrow } from "../src/sec/thirteenF/fetch13F.js";

async function main() {
  const cik = process.argv[2];
  if (!cik) {
    console.error("Usage: npx tsx scripts/fetch-13f-metadata.ts <CIK>");
    process.exit(1);
  }

  const result = await fetch13FOrThrow({ cik });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  if (err && typeof err === "object" && "code" in err) {
    console.error(`[${(err as { code: string }).code}]`, (err as Error).message);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
