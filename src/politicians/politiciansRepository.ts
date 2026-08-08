import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadPoliticiansSchemaSql } from "../db/schema.js";
import { politicianKey } from "./politicianKey.js";
import type { PoliticianPartyLookupResult } from "./enrichment/types.js";

export interface PoliticianRecord {
  politicianKey: string;
  bioguideId: string | null;
  name: string;
  chamber: "house" | "senate";
  state: string | null;
  district: string | null;
  party: string | null;
  partySource: string | null;
  partyLastUpdated: string | null;
}

const UPSERT_SQL = `
INSERT INTO politicians (
  politician_key, bioguide_id, name, chamber, state, district,
  party, party_source, party_last_updated, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, NOW())
ON CONFLICT (politician_key, chamber) DO UPDATE SET
  bioguide_id = COALESCE(EXCLUDED.bioguide_id, politicians.bioguide_id),
  name = EXCLUDED.name,
  state = COALESCE(EXCLUDED.state, politicians.state),
  district = COALESCE(EXCLUDED.district, politicians.district),
  party = EXCLUDED.party,
  party_source = EXCLUDED.party_source,
  party_last_updated = EXCLUDED.party_last_updated,
  updated_at = NOW()
`.trim();

const SELECT_BY_KEY_SQL = `
SELECT politician_key, bioguide_id, name, chamber, state, district,
       party, party_source, party_last_updated
FROM politicians
WHERE politician_key = $1 AND chamber = $2
LIMIT 1
`.trim();

const PARTY_STALE_DAYS = 30;

export class PoliticiansRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(loadPoliticiansSchemaSql());
  }

  async getByKey(
    key: string,
    chamber: "house" | "senate"
  ): Promise<PoliticianRecord | null> {
    const res = await this.pool.query<{
      politician_key: string;
      bioguide_id: string | null;
      name: string;
      chamber: "house" | "senate";
      state: string | null;
      district: string | null;
      party: string | null;
      party_source: string | null;
      party_last_updated: string | Date | null;
    }>(SELECT_BY_KEY_SQL, [key, chamber]);

    const row = res.rows[0];
    if (!row) return null;

    const updated =
      row.party_last_updated instanceof Date
        ? row.party_last_updated.toISOString().slice(0, 10)
        : row.party_last_updated
          ? String(row.party_last_updated).slice(0, 10)
          : null;

    return {
      politicianKey: row.politician_key,
      bioguideId: row.bioguide_id,
      name: row.name,
      chamber: row.chamber,
      state: row.state,
      district: row.district,
      party: row.party,
      partySource: row.party_source,
      partyLastUpdated: updated,
    };
  }

  isPartyFresh(record: PoliticianRecord | null): boolean {
    if (!record?.party || !record.partyLastUpdated) return false;
    const ts = Date.parse(`${record.partyLastUpdated}T00:00:00Z`);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < PARTY_STALE_DAYS * 24 * 60 * 60 * 1000;
  }

  recordFromLookup(
    lookup: PoliticianPartyLookupResult,
    chamber: "house" | "senate"
  ): PoliticianRecord {
    return {
      politicianKey: lookup.politicianKey || politicianKey(lookup.name),
      bioguideId: lookup.bioguideId ?? null,
      name: lookup.name,
      chamber,
      state: lookup.state,
      district: lookup.district ?? null,
      party: lookup.party,
      partySource: lookup.source,
      partyLastUpdated: lookup.last_updated,
    };
  }

  async upsertFromLookup(lookup: PoliticianPartyLookupResult, chamber: "house" | "senate"): Promise<void> {
    const record = this.recordFromLookup(lookup, chamber);
    await this.pool.query(UPSERT_SQL, [
      record.politicianKey,
      record.bioguideId,
      record.name,
      record.chamber,
      record.state,
      record.district,
      record.party,
      record.partySource,
      record.partyLastUpdated,
    ]);
  }

  async upsertMany(records: PoliticianRecord[]): Promise<void> {
    for (const record of records) {
      await this.pool.query(UPSERT_SQL, [
        record.politicianKey,
        record.bioguideId,
        record.name,
        record.chamber,
        record.state,
        record.district,
        record.party,
        record.partySource,
        record.partyLastUpdated,
      ]);
    }
  }
}

let singleton: PoliticiansRepository | null = null;

export function getPoliticiansRepository(): PoliticiansRepository {
  if (!singleton) singleton = new PoliticiansRepository();
  return singleton;
}

export async function tryGetCachedPoliticianParty(
  key: string,
  chamber: "house" | "senate"
): Promise<PoliticianPartyLookupResult | null> {
  try {
    const repo = getPoliticiansRepository();
    const row = await repo.getByKey(key, chamber);
    if (!repo.isPartyFresh(row) || !row?.party) return null;
    return {
      name: row.name,
      chamber: chamber === "house" ? "House" : "Senate",
      state: row.state,
      party: row.party,
      source: row.partySource || "database",
      last_updated: row.partyLastUpdated || new Date().toISOString().slice(0, 10),
      bioguideId: row.bioguideId,
      politicianKey: row.politicianKey,
      district: row.district,
    };
  } catch {
    return null;
  }
}

export async function persistPoliticianParty(
  lookup: PoliticianPartyLookupResult,
  chamber: "house" | "senate"
): Promise<void> {
  try {
    const repo = getPoliticiansRepository();
    await repo.ensureSchema();
    await repo.upsertFromLookup(lookup, chamber);
  } catch {
    /* DB optional for scraper */
  }
}
