import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HouseFilingIndexEntry, PoliticianTrade } from "./types.js";
import {
  fetchHouseFinancialIndex,
  fetchHousePtrTradesForFiling,
  summarizeHouseFiling,
} from "./house/fetchHouse.js";
import { sortHousePtrFilingsNewest } from "./house/parseIndex.js";
import { SenateEfdClient, type SenateSearchRow } from "./senate/efdClient.js";
import { enrichPoliticiansRecent } from "./enrichment/enrichRecent.js";
import { invalidatePoliticianRepeatBuyersCache } from "./repeatBuyers/service.js";
import { invalidatePoliticianFirstTimeBuyersCache } from "./firstTimeBuyers/service.js";
import { invalidatePoliticianHeavySellingCache } from "./heavySelling/service.js";

export const POLITICIANS_DATA_DIR = join("data", "politicians");
export const POLITICIANS_RECENT_PATH = join(POLITICIANS_DATA_DIR, "recent.json");

export interface PoliticianFilingBundle {
  chamber: "house" | "senate";
  politicianName: string;
  politicianKey?: string;
  bioguideId?: string | null;
  party?: string | null;
  partySource?: string | null;
  partyLastUpdated?: string | null;
  filingDate: string | null;
  filingId: string;
  sourceUrl: string;
  state?: string;
  district?: string;
  office?: string;
  tradeCount: number;
  trades: PoliticianTrade[];
}

export interface PoliticiansRecentPayload {
  fetchedAt: string;
  limitPerChamber: number;
  house: PoliticianFilingBundle[];
  senate: PoliticianFilingBundle[];
}

export interface FetchRecentPoliticiansOptions {
  limit?: number;
  houseYear?: number;
  outPath?: string;
  enrichParty?: boolean;
  forceRefreshPartyRoster?: boolean;
}

function houseBundle(
  filing: HouseFilingIndexEntry,
  trades: PoliticianTrade[]
): PoliticianFilingBundle {
  const summary = summarizeHouseFiling(filing);
  return {
    chamber: "house",
    politicianName: summary.name,
    filingDate: summary.filingDate || null,
    filingId: summary.docId,
    sourceUrl: trades[0]?.sourceUrl ?? "",
    state: trades[0]?.state,
    district: trades[0]?.district,
    tradeCount: trades.length,
    trades,
  };
}

function senateBundle(row: SenateSearchRow, trades: PoliticianTrade[]): PoliticianFilingBundle {
  return {
    chamber: "senate",
    politicianName: `${row.firstName} ${row.lastName}`.replace(/\s+/g, " ").trim(),
    filingDate: row.reportDate || trades[0]?.filingDate || null,
    filingId: row.reportId,
    sourceUrl: row.reportUrl,
    office: row.office,
    tradeCount: trades.length,
    trades,
  };
}

export async function fetchRecentPoliticianFilings(
  options: FetchRecentPoliticiansOptions = {}
): Promise<PoliticiansRecentPayload> {
  const limit = options.limit ?? 10;
  const houseYear = options.houseYear ?? new Date().getFullYear();
  const senate = new SenateEfdClient();

  const houseIndex = await fetchHouseFinancialIndex(houseYear);
  const houseFilings = houseIndex.filter((e) => e.filingType === "P" && e.docId);
  const newestHouse = sortHousePtrFilingsNewest(houseFilings).slice(0, limit);

  const house: PoliticianFilingBundle[] = [];
  for (const filing of newestHouse) {
    const trades = await fetchHousePtrTradesForFiling(filing);
    house.push(houseBundle(filing, trades));
  }

  const senateRows = await senate.listAllPtrFilings({ limit, htmlOnly: true });
  const senateOut: PoliticianFilingBundle[] = [];
  for (const row of senateRows) {
    const trades = await senate.fetchPtrTrades(row);
    senateOut.push(senateBundle(row, trades));
  }

  let payload: PoliticiansRecentPayload = {
    fetchedAt: new Date().toISOString(),
    limitPerChamber: limit,
    house,
    senate: senateOut,
  };

  if (options.enrichParty !== false) {
    payload = await enrichPoliticiansRecent(payload, {
      forceRefreshRoster: options.forceRefreshPartyRoster,
    });
  }

  return payload;
}

export function writePoliticiansRecent(
  payload: PoliticiansRecentPayload,
  outPath = POLITICIANS_RECENT_PATH
): void {
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  invalidatePoliticianRepeatBuyersCache();
  invalidatePoliticianFirstTimeBuyersCache();
  invalidatePoliticianHeavySellingCache();
}

export function readPoliticiansRecent(outPath = POLITICIANS_RECENT_PATH): PoliticiansRecentPayload | null {
  try {
    const raw = readFileSync(outPath, "utf8");
    return JSON.parse(raw) as PoliticiansRecentPayload;
  } catch {
    return null;
  }
}
