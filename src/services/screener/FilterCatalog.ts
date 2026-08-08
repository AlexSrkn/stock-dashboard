/**
 * Produces the client-facing filter catalog: every registry definition with its
 * dynamic option lists (sectors, industries, tracked institutions) resolved.
 * The UI renders its filter controls entirely from this catalog.
 */
import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { listFilterDefinitions } from "./FilterRegistry.js";
import { listAllInstitutions } from "../ownership/OwnershipSearch.js";
import { seedInstitutionRecords } from "../ownership/InstitutionDirectory.js";
import type { FilterDefinition, FilterOption } from "./FilterTypes.js";

export interface CatalogFilter extends Omit<FilterDefinition, "validate" | "sql"> {
  options?: FilterOption[];
}

export interface FilterCatalog {
  categories: string[];
  filters: CatalogFilter[];
}

async function loadDistinct(pool: pg.Pool, column: "sector" | "industry"): Promise<FilterOption[]> {
  const res = await pool.query<{ value: string }>(
    `SELECT DISTINCT ${column} AS value
     FROM stocks
     WHERE ${column} IS NOT NULL AND BTRIM(${column}) <> ''
     ORDER BY ${column} ASC`
  );
  return res.rows.map((r) => ({ value: r.value, label: r.value }));
}

async function institutionOptions(pool: pg.Pool): Promise<FilterOption[]> {
  // The "Held by Institution" filter matches on CIK, so option values are CIKs.
  try {
    const rows = await listAllInstitutions(pool);
    if (rows.length) {
      return rows.map((r) => ({ value: r.cik, label: r.name, meta: r.type }));
    }
  } catch {
    /* directory not built yet; fall back to seed list */
  }
  return seedInstitutionRecords()
    .map((r) => ({ value: r.cik, label: r.name, meta: r.type }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getFilterCatalog(pool: pg.Pool = getPool()): Promise<FilterCatalog> {
  let sectors: FilterOption[] = [];
  let industries: FilterOption[] = [];
  let institutions: FilterOption[] = [];
  try {
    [sectors, industries, institutions] = await Promise.all([
      loadDistinct(pool, "sector"),
      loadDistinct(pool, "industry"),
      institutionOptions(pool),
    ]);
  } catch {
    /* DB optional for catalog; static options still returned */
  }

  const filters: CatalogFilter[] = listFilterDefinitions().map((def) => {
    const { validate: _validate, sql: _sql, ...rest } = def;
    let options = def.options;
    if (def.dynamicOptions === "sectors") options = sectors;
    else if (def.dynamicOptions === "industries") options = industries;
    else if (def.dynamicOptions === "institutions") options = institutions;
    return { ...rest, options };
  });

  const categories = [...new Set(filters.map((f) => f.category))];
  return { categories, filters };
}
