import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { politicianFetch } from "../../http.js";
import type { EnrichmentChamber } from "../types.js";
import {
  LEGISLATORS_CURRENT_JSON_URL,
  PARTY_ROSTER_CACHE_PATH,
  PARTY_ROSTER_MAX_AGE_MS,
  PARTY_ROSTER_SOURCE,
} from "./constants.js";
import { normalizeParty } from "./normalizeParty.js";
import { namesLikelyMatch, normalizePoliticianDisplayName } from "./normalizeName.js";

export interface RosterMember {
  bioguideId: string;
  name: string;
  firstName: string;
  lastName: string;
  chamber: EnrichmentChamber;
  state: string;
  district: string | null;
  party: string;
}

export interface PartyRosterCacheFile {
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  members: RosterMember[];
}

interface LegislatorTerm {
  type?: string;
  state?: string;
  district?: number;
  party?: string;
  start?: string;
  end?: string;
}

interface LegislatorRecord {
  id?: { bioguide?: string };
  name?: {
    first?: string;
    last?: string;
    official_full?: string;
  };
  terms?: LegislatorTerm[];
}

export interface PartyRosterIndex {
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  byBioguide: Map<string, RosterMember>;
  byChamber: Map<EnrichmentChamber, RosterMember[]>;
}

let memoryIndex: PartyRosterIndex | null = null;

function chamberFromTermType(type: string | undefined): EnrichmentChamber | null {
  const t = String(type || "").toLowerCase();
  if (t === "sen") return "senate";
  if (t === "rep") return "house";
  return null;
}

function pickCurrentTerm(terms: LegislatorTerm[]): LegislatorTerm | null {
  if (!terms?.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const active = terms.filter((term) => !term.end || term.end >= today);
  return active.length ? active[active.length - 1]! : terms[terms.length - 1]!;
}

function formatDistrict(district: number | undefined): string | null {
  if (district == null || Number.isNaN(district)) return null;
  if (district === 0) return "At-Large";
  return String(district);
}

export function parseLegislatorsCurrentJson(raw: unknown): RosterMember[] {
  if (!Array.isArray(raw)) return [];
  const members: RosterMember[] = [];

  for (const row of raw as LegislatorRecord[]) {
    const bioguideId = String(row.id?.bioguide || "").trim();
    if (!bioguideId) continue;

    const term = pickCurrentTerm(row.terms || []);
    const chamber = chamberFromTermType(term?.type);
    const state = String(term?.state || "").trim().toUpperCase();
    const party = normalizeParty(term?.party);
    if (!chamber || !state || !party) continue;

    const firstName = String(row.name?.first || "").trim();
    const lastName = String(row.name?.last || "").trim();
    const name =
      normalizePoliticianDisplayName(row.name?.official_full || "") ||
      normalizePoliticianDisplayName(`${firstName} ${lastName}`.trim());
    if (!name) continue;

    members.push({
      bioguideId,
      name,
      firstName,
      lastName,
      chamber,
      state,
      district: chamber === "house" ? formatDistrict(term?.district) : null,
      party,
    });
  }

  return members;
}

export function buildPartyRosterIndex(
  members: RosterMember[],
  meta: { fetchedAt: string; source: string; sourceUrl: string }
): PartyRosterIndex {
  const byBioguide = new Map<string, RosterMember>();
  const byChamber = new Map<EnrichmentChamber, RosterMember[]>([
    ["house", []],
    ["senate", []],
  ]);

  for (const member of members) {
    byBioguide.set(member.bioguideId, member);
    byChamber.get(member.chamber)!.push(member);
  }

  return {
    fetchedAt: meta.fetchedAt,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    byBioguide,
    byChamber,
  };
}

function readDiskCache(cachePath = PARTY_ROSTER_CACHE_PATH): PartyRosterCacheFile | null {
  try {
    if (!existsSync(cachePath)) return null;
    return JSON.parse(readFileSync(cachePath, "utf8")) as PartyRosterCacheFile;
  } catch {
    return null;
  }
}

function writeDiskCache(
  members: RosterMember[],
  meta: { fetchedAt: string; source: string; sourceUrl: string },
  cachePath = PARTY_ROSTER_CACHE_PATH
): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  const payload: PartyRosterCacheFile = {
    fetchedAt: meta.fetchedAt,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    members,
  };
  writeFileSync(cachePath, JSON.stringify(payload, null, 2));
}

function cacheIsFresh(fetchedAt: string, maxAgeMs = PARTY_ROSTER_MAX_AGE_MS): boolean {
  const ts = Date.parse(fetchedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < maxAgeMs;
}

export async function fetchPartyRosterFromSource(): Promise<PartyRosterIndex> {
  const res = await politicianFetch(LEGISLATORS_CURRENT_JSON_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Party roster fetch failed (${res.status}) ${LEGISLATORS_CURRENT_JSON_URL}`);
  }
  const json = (await res.json()) as unknown;
  const members = parseLegislatorsCurrentJson(json);
  const fetchedAt = new Date().toISOString();
  const meta = {
    fetchedAt,
    source: PARTY_ROSTER_SOURCE,
    sourceUrl: LEGISLATORS_CURRENT_JSON_URL,
  };
  writeDiskCache(members, meta);
  memoryIndex = buildPartyRosterIndex(members, meta);
  return memoryIndex;
}

export function loadPartyRosterFromCache(
  cachePath = PARTY_ROSTER_CACHE_PATH
): PartyRosterIndex | null {
  const cached = readDiskCache(cachePath);
  if (!cached?.members?.length) return null;
  return buildPartyRosterIndex(cached.members, {
    fetchedAt: cached.fetchedAt,
    source: cached.source,
    sourceUrl: cached.sourceUrl,
  });
}

export async function ensurePartyRoster(options: {
  forceRefresh?: boolean;
  cachePath?: string;
} = {}): Promise<PartyRosterIndex> {
  if (memoryIndex && !options.forceRefresh && cacheIsFresh(memoryIndex.fetchedAt)) {
    return memoryIndex;
  }

  const cachePath = options.cachePath ?? PARTY_ROSTER_CACHE_PATH;
  if (!options.forceRefresh) {
    const cached = loadPartyRosterFromCache(cachePath);
    if (cached && cacheIsFresh(cached.fetchedAt)) {
      memoryIndex = cached;
      return cached;
    }
  }

  try {
    return await fetchPartyRosterFromSource();
  } catch (err) {
    const stale = loadPartyRosterFromCache(cachePath);
    if (stale) {
      memoryIndex = stale;
      return stale;
    }
    throw err;
  }
}

export function setPartyRosterIndex(index: PartyRosterIndex | null): void {
  memoryIndex = index;
}

export function normalizeState(state: string | null | undefined): string | null {
  const s = String(state || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

export function normalizeDistrict(district: string | null | undefined): string | null {
  const d = String(district || "").trim();
  if (!d) return null;
  if (/^at[- ]?large$/i.test(d)) return "At-Large";
  const n = Number(d);
  if (Number.isFinite(n) && n >= 0) return n === 0 ? "At-Large" : String(n);
  return d;
}

export function lookupPartyInRoster(
  index: PartyRosterIndex,
  input: {
    bioguideId?: string | null;
    name?: string | null;
    chamber: EnrichmentChamber;
    state?: string | null;
    district?: string | null;
  }
): RosterMember | null {
  const bioguide = String(input.bioguideId || "").trim();
  if (bioguide && index.byBioguide.has(bioguide)) {
    const hit = index.byBioguide.get(bioguide)!;
    if (hit.chamber === input.chamber) return hit;
  }

  const state = normalizeState(input.state);
  const district = normalizeDistrict(input.district);
  const pool = index.byChamber.get(input.chamber) || [];
  const name = normalizePoliticianDisplayName(String(input.name || ""));

  let candidates = pool;
  if (state) candidates = candidates.filter((m) => m.state === state);

  if (name) {
    candidates = candidates.filter((m) => namesLikelyMatch(name, m.name));
  }

  if (input.chamber === "house" && district && candidates.length > 1) {
    const byDistrict = candidates.filter((m) => normalizeDistrict(m.district) === district);
    if (byDistrict.length === 1) return byDistrict[0]!;
    if (byDistrict.length > 1) candidates = byDistrict;
  }

  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1 && name) {
    const exact = candidates.find(
      (m) => normalizePoliticianDisplayName(m.name).toLowerCase() === name.toLowerCase()
    );
    if (exact) return exact;
  }

  return null;
}

/** Load fixture JSON for tests (path relative to project root). */
export function loadPartyRosterFixture(fixturePath: string): PartyRosterIndex {
  const abs = join(process.cwd(), fixturePath);
  const raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
  const members = parseLegislatorsCurrentJson(raw);
  return buildPartyRosterIndex(members, {
    fetchedAt: new Date().toISOString(),
    source: "test-fixture",
    sourceUrl: fixturePath,
  });
}
