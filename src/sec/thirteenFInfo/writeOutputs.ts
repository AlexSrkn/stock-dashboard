import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThirteenFInfoManagerCandidate, ThirteenFInfoScrapeResult } from "./types.js";

function csvEscape(value: string | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function candidatesToCsv(rows: ThirteenFInfoManagerCandidate[]): string {
  const header = [
    "id",
    "manager_name",
    "location",
    "latest_filing_quarter",
    "latest_filing_date",
    "source_url",
    "source",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.id),
        csvEscape(row.manager_name),
        csvEscape(row.location),
        csvEscape(row.latest_filing_quarter),
        csvEscape(row.latest_filing_date),
        csvEscape(row.source_url),
        csvEscape(row.source),
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

export function writeThirteenFInfoOutputs(
  result: ThirteenFInfoScrapeResult,
  outDir: string
): { jsonPath: string; csvPath: string; allJsonPath: string } {
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, "managers-candidates.json");
  const csvPath = join(outDir, "managers-candidates.csv");
  const allJsonPath = join(outDir, "managers-all.json");

  const payload = {
    scrapedAt: result.scrapedAt,
    minimumQuarter: result.minimumQuarter,
    source: result.source,
    directoryUrl: result.directoryUrl,
    stats: result.stats,
    candidates: result.candidates,
  };

  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  writeFileSync(csvPath, candidatesToCsv(result.candidates));
  writeFileSync(
    allJsonPath,
    JSON.stringify(
      {
        scrapedAt: result.scrapedAt,
        minimumQuarter: result.minimumQuarter,
        source: result.source,
        stats: result.stats,
        managers: result.allManagers,
      },
      null,
      2
    )
  );

  return { jsonPath, csvPath, allJsonPath };
}

export function printScrapeSummary(result: ThirteenFInfoScrapeResult): void {
  const s = result.stats;
  console.log("\n=== 13f.info managers scrape summary ===");
  console.log(`minimum_quarter:              ${s.minimumQuarter}`);
  console.log(`total managers scraped:       ${s.totalManagersScraped}`);
  console.log(`with detectable quarter:      ${s.totalWithDetectableQuarter}`);
  console.log(`included (>= minimum):        ${s.totalIncluded}`);
  console.log(`excluded (< minimum):         ${s.totalExcluded}`);
  console.log(`exact duplicates removed:     ${s.exactDuplicatesRemoved}`);
  console.log(`missing filing-quarter info:  ${s.missingFilingQuarter}`);
  console.log("\nFirst 20 included records:");
  for (const row of result.candidates.slice(0, 20)) {
    console.log(
      `  ${row.latest_filing_quarter} · ${row.manager_name}` +
        (row.location ? ` · ${row.location}` : "") +
        ` · ${row.source_url}`
    );
  }
  if (result.candidates.length > 20) {
    console.log(`  … and ${result.candidates.length - 20} more`);
  }
}
