import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSTITUTIONAL_13F_MANAGERS,
  type Institutional13FManager,
} from "../sec/seed/institutional-ciks.js";
import { formatSecCik } from "../sec/http.js";

/** Written by the 13f.info bulk importer; merged into the tracked universe. */
export const IMPORTED_TRACKED_MANAGERS_PATH = join(
  process.cwd(),
  "data",
  "13f-info",
  "imported-tracked-managers.json"
);

export function paddedInstitutionalCik(cik: string): string {
  return formatSecCik(cik);
}

type TrackedManager = Institutional13FManager & { cik: string };

const trackedManagers: TrackedManager[] = [];
const trackedCiksPadded: string[] = [];
const byCik = new Map<string, TrackedManager>();

function readImportedTrackedManagers(): TrackedManager[] {
  if (!existsSync(IMPORTED_TRACKED_MANAGERS_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(IMPORTED_TRACKED_MANAGERS_PATH, "utf8")) as unknown;
    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { managers?: unknown })?.managers)
        ? (raw as { managers: unknown[] }).managers
        : [];
    const out: TrackedManager[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { name?: unknown; cik?: unknown; type?: unknown };
      const cikRaw = String(rec.cik ?? "").replace(/\D/g, "");
      const name = String(rec.name ?? "").trim();
      if (!cikRaw || !name) continue;
      const type =
        rec.type === "hedge_fund" ||
        rec.type === "asset_manager" ||
        rec.type === "quant" ||
        rec.type === "activist"
          ? rec.type
          : "hedge_fund";
      out.push({ name, cik: cikRaw, type });
    }
    return out;
  } catch {
    return [];
  }
}

function curatedTrackedManagers(): TrackedManager[] {
  return INSTITUTIONAL_13F_MANAGERS.filter(
    (m): m is Institutional13FManager & { cik: string } => m.cik != null && m.cik !== ""
  );
}

/** Rebuild curated + imported tracked managers (idempotent; curated wins on CIK clash). */
export function reloadTrackedInstitutions(): void {
  trackedManagers.length = 0;
  trackedCiksPadded.length = 0;
  byCik.clear();

  const merged = new Map<string, TrackedManager>();
  for (const manager of [...curatedTrackedManagers(), ...readImportedTrackedManagers()]) {
    const padded = paddedInstitutionalCik(manager.cik);
    if (!merged.has(padded)) {
      merged.set(padded, manager);
    }
  }

  for (const [padded, manager] of merged) {
    trackedManagers.push(manager);
    trackedCiksPadded.push(padded);
    byCik.set(padded, manager);
  }
}

reloadTrackedInstitutions();

/** Curated 13F filers + imported 13f.info managers (padded lookups via helpers). */
export const TRACKED_INSTITUTIONAL_MANAGERS: readonly Institutional13FManager[] =
  trackedManagers;

export const TRACKED_INSTITUTIONAL_CIK_PADDED: readonly string[] = trackedCiksPadded;

export function getTrackedInstitutionByCik(
  filerCik: string
): Institutional13FManager | undefined {
  return byCik.get(paddedInstitutionalCik(filerCik));
}

export function canonicalFundName(filerCik: string, fundNameFromDb: string): string {
  return getTrackedInstitutionByCik(filerCik)?.name ?? fundNameFromDb;
}
