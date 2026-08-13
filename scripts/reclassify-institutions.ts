/**
 * Reclassify imported + DB institutions into hub categories
 * (asset_manager | hedge_fund | quant | activist) using name heuristics.
 * Curated seed types always win.
 *
 *   npx tsx scripts/reclassify-institutions.ts
 *   npx tsx scripts/reclassify-institutions.ts --dry-run
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { inferInstitutionalManagerType } from "../src/ownership/classifyInstitutionalManager.js";
import {
  IMPORTED_TRACKED_MANAGERS_PATH,
  reloadTrackedInstitutions,
} from "../src/ownership/trackedInstitutions.js";
import { INSTITUTIONAL_13F_MANAGERS } from "../src/sec/seed/institutional-ciks.js";
import type { InstitutionalManagerType } from "../src/sec/seed/institutional-ciks.js";
import {
  classifyInstitutionType,
  institutionRecordFromName,
  upsertInstitutionRecord,
} from "../src/services/ownership/InstitutionDirectory.js";

loadEnvFile();

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function normCik(cik: string): string {
  return String(cik).replace(/\D/g, "").replace(/^0+/, "") || "0";
}

function curatedTypeByCik(): Map<string, InstitutionalManagerType> {
  const map = new Map<string, InstitutionalManagerType>();
  for (const m of INSTITUTIONAL_13F_MANAGERS) {
    if (!m.cik) continue;
    map.set(normCik(m.cik), m.type);
  }
  return map;
}

function resolveType(name: string, cik: string, curated: Map<string, InstitutionalManagerType>): InstitutionalManagerType {
  return curated.get(normCik(cik)) ?? inferInstitutionalManagerType(name);
}

async function main() {
  const dryRun = argFlag("--dry-run");
  const curated = curatedTypeByCik();
  const pool = getPool();

  const { rows } = await pool.query<{ cik: string; name: string; type: string }>(
    `SELECT cik, name, type FROM institution ORDER BY name`
  );

  const counts: Record<InstitutionalManagerType, number> = {
    asset_manager: 0,
    hedge_fund: 0,
    quant: 0,
    activist: 0,
  };
  const dbTypeCounts = new Map<string, number>();
  let changed = 0;
  const sampleChanges: Array<{ name: string; from: string; to: InstitutionalManagerType; dbType: string }> = [];

  const supplement: Array<{ name: string; cik: string; type: InstitutionalManagerType }> = [];

  for (const row of rows) {
    const cikRaw = String(row.cik).replace(/\D/g, "");
    const cik = normCik(cikRaw);
    const name = String(row.name || "").trim();
    if (!cikRaw || !name) continue;

    const seedType = resolveType(name, cik, curated);
    counts[seedType] += 1;
    const dbType = classifyInstitutionType(name, seedType);
    dbTypeCounts.set(dbType, (dbTypeCounts.get(dbType) || 0) + 1);

    const prevDb = row.type;
    if (prevDb !== dbType) {
      changed += 1;
      if (sampleChanges.length < 25) {
        sampleChanges.push({ name, from: prevDb, to: seedType, dbType });
      }
      if (!dryRun) {
        const rec = institutionRecordFromName(cikRaw, name, seedType);
        await upsertInstitutionRecord(rec, pool, { keepExistingName: true });
      }
    }

    // Supplement stores unpadded CIK; curated seed wins on merge by padded key.
    supplement.push({ name, cik, type: seedType });
  }

  console.log("=== Institution reclassify ===");
  console.log(`institutions: ${rows.length}`);
  console.log("hub categories (seed keys):", counts);
  console.log("DB types:", Object.fromEntries([...dbTypeCounts.entries()].sort((a, b) => b[1] - a[1])));
  console.log(`type changes vs current DB: ${changed}${dryRun ? " (dry-run)" : ""}`);
  if (sampleChanges.length) {
    console.log("\nSample changes:");
    for (const s of sampleChanges) {
      console.log(`  ${s.name}: "${s.from}" → hub=${s.to} db=${s.dbType}`);
    }
  }

  if (!dryRun) {
    mkdirSync(join(IMPORTED_TRACKED_MANAGERS_PATH, ".."), { recursive: true });
    // Keep curated CIKs out of the supplement file (curated seed already supplies them).
    const curatedCiks = new Set(curated.keys());
    const importedOnly = supplement.filter((m) => !curatedCiks.has(normCik(m.cik)));
    writeFileSync(
      IMPORTED_TRACKED_MANAGERS_PATH,
      JSON.stringify(
        { updatedAt: new Date().toISOString(), managers: importedOnly.sort((a, b) => a.name.localeCompare(b.name)) },
        null,
        2
      )
    );
    reloadTrackedInstitutions();
    console.log(
      `\nWrote ${importedOnly.length} managers (excluded ${supplement.length - importedOnly.length} curated) → ${IMPORTED_TRACKED_MANAGERS_PATH}`
    );
    console.log("Restart the server so hub filters pick up new types.");
  } else if (!existsSync(IMPORTED_TRACKED_MANAGERS_PATH)) {
    console.log("\n(no supplement file yet; run without --dry-run to write)");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
