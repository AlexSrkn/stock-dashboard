/**
 * End-to-end proof of the SEC 13F pipeline for one filer CIK.
 *
 * Usage: npx tsx scripts/prove-13f-pipeline.ts [CIK]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetch13FOrThrow } from "../src/sec/thirteenF/fetch13F.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const p = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();
import { download13FInfoTableXml } from "../src/sec/thirteenF/downloadInfoTable.js";
import { parse13F } from "../src/sec/thirteenF/parse13F.js";
import {
  normalizeHoldings,
  toHoldingDbInserts,
  toHoldings,
} from "../src/sec/thirteenF/normalizeHoldings.js";
import { fetchAndNormalize13FFilings } from "../src/sec/thirteenF/pipeline.js";

const CIK = process.argv[2] ?? "1067983";

function ok(label: string, detail: string) {
  console.log(`  OK  ${label}: ${detail}`);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function proveModularSteps() {
  section("1. fetch13F — latest filing metadata");
  const { latest, filerName, cik } = await fetch13FOrThrow({ cik: CIK });
  ok("filer", `${filerName} (CIK ${cik})`);
  ok("form", `${latest.formType} · ${latest.accessionNumber}`);
  ok("dates", `filed ${latest.filingDate} · period ${latest.reportDate ?? "—"}`);

  section("2. downloadInfoTable — raw XML");
  const { xml, documentName, url } = await download13FInfoTableXml(latest, { maxAttempts: 3 });
  ok("document", documentName);
  ok("bytes", String(xml.length));
  ok("url", url);

  section("3. parse13F — typed rows");
  const parsed = parse13F(xml);
  ok("holdings", String(parsed.length));
  ok("sample", `${parsed[0].issuer} · ${parsed[0].cusip} · ${parsed[0].shares} sh · $${parsed[0].value}k`);

  section("4. normalizeHoldings — clean + DB-ready");
  const normalized = normalizeHoldings(parsed, {
    fundName: latest.filerName,
    filerCik: latest.filerCik,
    accessionNumber: latest.accessionNumber,
    filingDate: latest.filingDate,
    reportPeriod: latest.reportDate,
  });
  const appHoldings = toHoldings(normalized);
  const dbRows = toHoldingDbInserts(normalized);
  ok("normalized", String(normalized.length));
  ok("quarter", appHoldings[0].quarter);
  ok("db row", `${dbRows[0].issuer} · hash ${dbRows[0].row_hash.slice(0, 12)}…`);

  return { parsedCount: parsed.length, normalizedCount: normalized.length };
}

async function proveIntegratedPipeline() {
  section("5. pipeline — fetchAndNormalize13FFilings (limit 1)");
  const results = await fetchAndNormalize13FFilings({
    filerCik: CIK,
    limit: 1,
    maxAttempts: 3,
  });
  const r = results[0];
  ok("filings", String(results.length));
  ok("meta", `${r.filing.formType} · ${r.filing.holdingsCount} holdings`);
  ok("postgres filing", r.postgres.filing.accession_number);
  ok("postgres holdings", String(r.postgres.holdings.length));
  ok(
    "sample insert",
    `${r.postgres.holdings[0].name_of_issuer} · ${r.postgres.holdings[0].cusip}`
  );
  return r.filing.holdingsCount;
}

async function main() {
  if (!process.env.SEC_USER_AGENT?.trim()) {
    console.error("Set SEC_USER_AGENT in .env or environment (name + email).");
    process.exit(1);
  }

  console.log(`SEC 13F pipeline proof · filer CIK ${CIK}`);
  const t0 = Date.now();

  const modular = await proveModularSteps();
  const integrated = await proveIntegratedPipeline();

  if (modular.parsedCount !== modular.normalizedCount) {
    throw new Error("Parsed vs normalized count mismatch");
  }
  if (integrated !== modular.parsedCount) {
    throw new Error(`Pipeline holdings (${integrated}) != modular (${modular.parsedCount})`);
  }

  section("RESULT");
  console.log(`  All stages passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${integrated} holdings from latest 13F filing`);
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
