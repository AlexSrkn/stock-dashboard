/**
 * Bulk-import 13f.info managers into the existing institution + 13F ingest pipeline.
 *
 * Does not rewrite EDGAR/13F parsing or performance math — only feeds CIKs through
 * upsertInstitutionRecord + ingestRecent13FForCik, then ownership cache rebuild.
 *
 * Examples:
 *   npx tsx scripts/import-13f-info-institutions.ts --plan
 *   npx tsx scripts/import-13f-info-institutions.ts --limit-new=25
 *   npx tsx scripts/import-13f-info-institutions.ts --minimum-quarter=2026-Q1
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import {
  IMPORTED_TRACKED_MANAGERS_PATH,
  reloadTrackedInstitutions,
} from "../src/ownership/trackedInstitutions.js";
import { ingestRecent13FForCik } from "../src/sec/ingest/ingestLatest13F.js";
import {
  loadThirteenFInfoImportUniverse,
  type ImportManagerCandidate,
} from "../src/sec/thirteenFInfo/importUniverse.js";
import { DEFAULT_MINIMUM_QUARTER } from "../src/sec/thirteenFInfo/scrapeManagers.js";
import { inferInstitutionalManagerType } from "../src/ownership/classifyInstitutionalManager.js";
import {
  institutionRecordFromName,
  loadInstitutionDirectoryByCik,
  upsertInstitutionRecord,
} from "../src/services/ownership/InstitutionDirectory.js";
import { runOwnershipImport } from "../src/services/ownership/OwnershipImporter.js";
import type { InstitutionalManagerType } from "../src/sec/seed/institutional-ciks.js";

loadEnvFile();

const SEC_DELAY_MS = 250;
const DEFAULT_FILING_LIMIT = 8;
const PROGRESS_PATH = join("data", "13f-info", "import-progress.json");

interface ProgressState {
  minimumQuarter: string;
  completedCiks: string[];
  failed: Array<{ cik: string; name: string; error: string; at: string }>;
  updatedAt: string;
}

interface NameConflict {
  cik: string;
  existingName: string;
  candidateName: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function loadProgress(minimumQuarter: string): ProgressState {
  if (!existsSync(PROGRESS_PATH)) {
    return {
      minimumQuarter,
      completedCiks: [],
      failed: [],
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    const raw = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as ProgressState;
    if (raw.minimumQuarter !== minimumQuarter) {
      return {
        minimumQuarter,
        completedCiks: [],
        failed: [],
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      minimumQuarter,
      completedCiks: Array.isArray(raw.completedCiks) ? raw.completedCiks : [],
      failed: Array.isArray(raw.failed) ? raw.failed : [],
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  } catch {
    return {
      minimumQuarter,
      completedCiks: [],
      failed: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

function saveProgress(state: ProgressState): void {
  mkdirSync(join(PROGRESS_PATH, ".."), { recursive: true });
  writeFileSync(
    PROGRESS_PATH,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)
  );
}

function mergeImportedTrackedFile(managers: ImportManagerCandidate[]): number {
  mkdirSync(join(IMPORTED_TRACKED_MANAGERS_PATH, ".."), { recursive: true });
  const existing = existsSync(IMPORTED_TRACKED_MANAGERS_PATH)
    ? (JSON.parse(readFileSync(IMPORTED_TRACKED_MANAGERS_PATH, "utf8")) as unknown)
    : [];
  const rows = Array.isArray(existing)
    ? existing
    : Array.isArray((existing as { managers?: unknown })?.managers)
      ? ((existing as { managers: unknown[] }).managers as unknown[])
      : [];

  const byCik = new Map<string, { name: string; cik: string; type: InstitutionalManagerType }>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { name?: string; cik?: string; type?: InstitutionalManagerType };
    const cik = String(rec.cik ?? "").replace(/\D/g, "");
    const name = String(rec.name ?? "").trim();
    if (!cik || !name) continue;
    byCik.set(cik, {
      name,
      cik,
      type: rec.type || "hedge_fund",
    });
  }
  for (const m of managers) {
    const cik = m.cik.replace(/\D/g, "");
    const inferred = inferInstitutionalManagerType(m.manager_name);
    const prev = byCik.get(cik);
    if (!prev) {
      byCik.set(cik, { name: m.manager_name, cik, type: inferred });
    } else if (prev.type === "hedge_fund" && inferred !== "hedge_fund") {
      // Upgrade a prior default when we now have a better name-based label.
      byCik.set(cik, { ...prev, type: inferred });
    }
  }
  const out = [...byCik.values()].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(
    IMPORTED_TRACKED_MANAGERS_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), managers: out }, null, 2)
  );
  reloadTrackedInstitutions();
  return out.length;
}

async function main() {
  const minimumQuarter = argValue("--minimum-quarter") || DEFAULT_MINIMUM_QUARTER;
  const sourcePath =
    argValue("--source") || join("data", "13f-info", "managers-all.json");
  const limitNew = Number(argValue("--limit-new") ?? "0") || 0;
  const limit = Number(argValue("--limit") ?? "0") || 0;
  const from = Math.max(0, Number(argValue("--from") ?? "0") || 0);
  const filingLimit = Math.max(
    1,
    Math.min(40, Number(argValue("--filings") ?? String(DEFAULT_FILING_LIMIT)) || DEFAULT_FILING_LIMIT)
  );
  const planOnly = argFlag("--plan");
  const newOnly = argFlag("--new-only") || limitNew > 0;
  const skipIngest = argFlag("--skip-ingest");
  const skipCache = argFlag("--skip-cache");
  const ensureSchema = argFlag("--ensure-schema");
  const resetProgress = argFlag("--reset-progress");
  const delayMs = Math.max(0, Number(argValue("--delay-ms") ?? String(SEC_DELAY_MS)) || SEC_DELAY_MS);
  /** Exit cleanly after N ingest attempts so a watchdog can restart a fresh process (avoids long-run native crashes). */
  const batchSize = Math.max(0, Number(argValue("--batch-size") ?? "0") || 0);

  const universe = loadThirteenFInfoImportUniverse({ path: sourcePath, minimumQuarter });
  const pool = getPool();
  const existing = await loadInstitutionDirectoryByCik(pool);

  const alreadyExist: ImportManagerCandidate[] = [];
  const toCreate: ImportManagerCandidate[] = [];
  const conflicts: NameConflict[] = [];

  for (const m of universe.managers) {
    const row = existing.get(m.cik);
    if (row) {
      alreadyExist.push(m);
      if (row.name.trim().toLowerCase() !== m.manager_name.trim().toLowerCase()) {
        conflicts.push({
          cik: m.cik,
          existingName: row.name,
          candidateName: m.manager_name,
        });
      }
    } else {
      toCreate.push(m);
    }
  }

  console.log("=== 13f.info → institution import plan ===");
  console.log(`source:                 ${universe.sourcePath}`);
  console.log(`minimum_quarter:        ${universe.minimumQuarter}`);
  console.log(`universe (filtered):    ${universe.managers.length}`);
  console.log(`skipped below quarter:  ${universe.skippedBelowQuarter}`);
  console.log(`skipped missing CIK:    ${universe.skippedMissingCik}`);
  console.log(`exact CIK dupes dropped:${universe.exactCikDuplicatesRemoved}`);
  console.log(`already exist (CIK):    ${alreadyExist.length}`);
  console.log(`will create:            ${toCreate.length}`);
  console.log(`CIK/name conflicts:     ${conflicts.length}`);

  if (conflicts.length) {
    console.log("\nFirst 20 CIK/name conflicts (reuse existing name):");
    for (const c of conflicts.slice(0, 20)) {
      console.log(`  ${c.cik}: DB="${c.existingName}" vs 13f.info="${c.candidateName}"`);
    }
    if (conflicts.length > 20) console.log(`  … and ${conflicts.length - 20} more`);
  }

  let work = newOnly ? [...toCreate] : [...universe.managers];
  if (from) work = work.slice(from);
  if (limitNew > 0) work = work.slice(0, limitNew);
  else if (limit > 0) work = work.slice(0, limit);

  const createCount = work.filter((m) => !existing.has(m.cik)).length;
  const reuseCount = work.length - createCount;
  console.log(`\nThis run queue:         ${work.length} (create ${createCount}, reuse ${reuseCount})`);

  if (planOnly) {
    console.log("\n--plan only; no writes or ingest.");
    console.log("Example test: npm run institutions:import-13f-info -- --limit-new=25");
    console.log(
      "Full import:  npm run institutions:import-13f-info -- --minimum-quarter=2026-Q1"
    );
    return;
  }

  if (!work.length) {
    console.log("Nothing to process.");
    return;
  }

  let progress = resetProgress
    ? {
        minimumQuarter: universe.minimumQuarter,
        completedCiks: [] as string[],
        failed: [] as ProgressState["failed"],
        updatedAt: new Date().toISOString(),
      }
    : loadProgress(universe.minimumQuarter);
  const completed = new Set(progress.completedCiks);
  const pendingAll = work.filter((m) => !completed.has(m.cik));
  const pending =
    batchSize > 0 ? pendingAll.slice(0, batchSize) : pendingAll;
  console.log(
    `\nResume state: ${completed.size} already completed, ${pendingAll.length} remaining` +
      (batchSize > 0 ? ` (this batch ${pending.length}/${batchSize})` : "") +
      ` of ${work.length} queued`
  );

  const createdNow: string[] = [];
  const ingestedOk: Array<{ cik: string; name: string; filings: number; holdings: number; dupes: number }> =
    [];
  const ingestFailed: Array<{ cik: string; name: string; error: string }> = [];

  // Upsert only this batch (keeps resume memory/time bounded).
  const upsertTargets = pending.length ? pending : [];
  const supplementRows: ImportManagerCandidate[] = [];
  for (const m of upsertTargets) {
    const exists = existing.has(m.cik);
    const displayName = exists ? existing.get(m.cik)!.name : m.manager_name;
    const seedType = inferInstitutionalManagerType(displayName);
    const rec = institutionRecordFromName(m.cik, displayName, seedType);
    await upsertInstitutionRecord(rec, pool, { keepExistingName: exists });
    if (!exists) {
      createdNow.push(m.cik);
      existing.set(m.cik, { cik: m.cik, name: displayName, type: rec.type });
    }
    supplementRows.push({ ...m, manager_name: displayName });
  }
  if (supplementRows.length) mergeImportedTrackedFile(supplementRows);
  console.log(
    `Directory upserts done for ${upsertTargets.length} manager(s). Created ${createdNow.length} new institution row(s).`
  );

  if (skipIngest) {
    console.log("Skipped ingest (--skip-ingest).");
    return;
  }

  if (!pending.length) {
    console.log("Nothing left to ingest — progress file is complete for this queue.");
  }

  let schemaReady = !ensureSchema;
  console.log(
    `\nIngesting via existing pipeline (filings=${filingLimit}, delay=${delayMs}ms, ensureSchema=${ensureSchema})… ` +
      `${pending.length} in this process / ${pendingAll.length} remaining overall`
  );

  for (let i = 0; i < pending.length; i++) {
    const m = pending[i];
    const existingName = existing.get(m.cik)?.name || m.manager_name;
    const overallDone = completed.size;
    process.stdout.write(
      `[${i + 1}/${pending.length} · total ${overallDone + 1}/${work.length}] ${existingName} (${m.cik})… `
    );
    try {
      const result = await ingestRecent13FForCik(m.cik, {
        fundName: existingName,
        ensureSchema: ensureSchema && !schemaReady,
        filingLimit,
      });
      schemaReady = true;
      const holdingsInserted = result.results.reduce((s, r) => s + r.holdingsInserted, 0);
      const duplicates = result.results.filter((r) => r.duplicateFiling).length;
      ingestedOk.push({
        cik: m.cik,
        name: existingName,
        filings: result.filingsProcessed,
        holdings: holdingsInserted,
        dupes: duplicates,
      });
      // Cap in-memory samples so long batches don't retain every result object.
      if (ingestedOk.length > 50) ingestedOk.splice(0, ingestedOk.length - 50);
      completed.add(m.cik);
      progress.completedCiks = [...completed];
      progress.failed = progress.failed.filter((f) => f.cik !== m.cik);
      saveProgress(progress);
      console.log(
        `ok (${result.filingsProcessed} filing(s), ${holdingsInserted} holdings` +
          (duplicates ? `, ${duplicates} duplicate(s)` : "") +
          ")"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ingestFailed.push({ cik: m.cik, name: existingName, error: message });
      progress.failed = [
        ...progress.failed.filter((f) => f.cik !== m.cik),
        { cik: m.cik, name: existingName, error: message, at: new Date().toISOString() },
      ];
      saveProgress(progress);
      console.log(`failed: ${message}`);
    }
    if (i < pending.length - 1) await sleep(delayMs);
  }

  const stillRemaining = work.filter((m) => !completed.has(m.cik)).length;
  console.log("\n=== Batch / run results ===");
  console.log(`already existed in queue: ${reuseCount}`);
  console.log(`created this run:         ${createdNow.length}`);
  console.log(`ingest succeeded:         ${ingestedOk.length}`);
  console.log(`ingest failed:            ${ingestFailed.length}`);
  console.log(`still remaining:          ${stillRemaining}`);
  if (ingestedOk.length) {
    console.log("\nSample successful ingest (up to 10):");
    for (const row of ingestedOk.slice(0, 10)) {
      console.log(
        `  ${row.cik} · ${row.name} · filings=${row.filings} holdings=${row.holdings} dupes=${row.dupes}`
      );
    }
  }
  if (ingestFailed.length) {
    console.log("\nFailures:");
    for (const row of ingestFailed) {
      console.log(`  ${row.cik} · ${row.name}: ${row.error}`);
    }
    process.exitCode = 1;
  }

  const totalHoldings = ingestedOk.reduce((s, r) => s + r.holdings, 0);
  const shouldBuildCache =
    !skipCache && stillRemaining === 0 && ingestedOk.length > 0 && totalHoldings > 0;
  if (shouldBuildCache) {
    console.log("\nRebuilding ownership cache (existing pipeline)…");
    reloadTrackedInstitutions();
    const res = await runOwnershipImport();
    console.log(
      `Ownership cache built: ${res.build.tickers} tickers, ${res.build.holdings} holdings, ` +
        `${res.institutions} institutions in ${(res.build.durationMs / 1000).toFixed(1)}s.`
    );
  } else if (skipCache) {
    console.log("\nSkipped ownership cache rebuild (--skip-cache).");
  } else if (stillRemaining > 0) {
    console.log("\nDeferred ownership cache rebuild until import is fully complete.");
  }

  console.log(`\nProgress file: ${PROGRESS_PATH}`);
  console.log(`Tracked supplement: ${IMPORTED_TRACKED_MANAGERS_PATH}`);
  if (stillRemaining > 0) {
    console.log(`Batch complete — ${stillRemaining} left. Re-run / watchdog will continue.`);
    // Distinct exit code for watchdog: more work remains (not a failure).
    if (batchSize > 0 && process.exitCode !== 1) process.exitCode = 2;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
