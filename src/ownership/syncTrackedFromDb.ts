/**
 * Expand the tracked institution universe from distinct 13F filers already in Postgres.
 * Writes data/13f-info/imported-tracked-managers.json (merged into TRACKED_* on reload)
 * and upserts the institution directory used by ownership cache / search.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type pg from "pg";
import { formatSecCik } from "../sec/http.js";
import type { InstitutionalManagerType } from "../sec/seed/institutional-ciks.js";
import { inferInstitutionalManagerType } from "./classifyInstitutionalManager.js";
import {
  IMPORTED_TRACKED_MANAGERS_PATH,
  reloadTrackedInstitutions,
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "./trackedInstitutions.js";
import {
  institutionRecordFromName,
  upsertInstitutionRecords,
} from "../services/ownership/InstitutionDirectory.js";

export interface SyncTrackedFromDbResult {
  filersInDb: number;
  trackedAfter: number;
  upserted: number;
}

export async function syncTrackedInstitutionsFromDb(
  pool: pg.Pool
): Promise<SyncTrackedFromDbResult> {
  const res = await pool.query<{ filer_cik: string; fund_name: string }>(`
    SELECT DISTINCT ON (filer_cik)
      filer_cik,
      COALESCE(NULLIF(BTRIM(fund_name), ''), filer_cik) AS fund_name
    FROM sec_filing
    WHERE filer_cik IS NOT NULL AND BTRIM(filer_cik) <> ''
    ORDER BY filer_cik, filing_date DESC NULLS LAST, id DESC
  `);

  const managers: Array<{ name: string; cik: string; type: InstitutionalManagerType }> = [];
  const records: ReturnType<typeof institutionRecordFromName>[] = [];
  for (const row of res.rows) {
    const cikDigits = String(row.filer_cik).replace(/\D/g, "");
    if (!cikDigits) continue;
    const name = String(row.fund_name || "").trim() || cikDigits;
    const type = inferInstitutionalManagerType(name);
    managers.push({ name, cik: cikDigits, type });
    records.push(institutionRecordFromName(cikDigits, name, type));
  }

  managers.sort((a, b) => a.name.localeCompare(b.name));

  mkdirSync(dirname(IMPORTED_TRACKED_MANAGERS_PATH), { recursive: true });
  writeFileSync(
    IMPORTED_TRACKED_MANAGERS_PATH,
    JSON.stringify(
      { updatedAt: new Date().toISOString(), source: "sec_filing", managers },
      null,
      2
    )
  );

  const upserted = await upsertInstitutionRecords(records, pool, { keepExistingName: true });
  reloadTrackedInstitutions();

  return {
    filersInDb: managers.length,
    trackedAfter: TRACKED_INSTITUTIONAL_MANAGERS.length,
    upserted,
  };
}
