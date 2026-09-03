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
import { parseUsDateToIso, cleanPoliticianTicker } from "./normalize.js";

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
  /** Present when an incremental since-date fetch was used. */
  sinceDate?: string | null;
  scrapeErrors?: PoliticianScrapeError[];
}

export interface PoliticianScrapeError {
  chamber: "house" | "senate";
  politicianName: string;
  filingId: string;
  filingDate: string | null;
  sourceUrl?: string;
  message: string;
}

export interface FetchRecentPoliticiansOptions {
  limit?: number;
  houseYear?: number;
  /** Inclusive ISO date (YYYY-MM-DD). When set, fetch all PTR filings on/after this date. */
  sinceDate?: string | null;
  /** Merge newly fetched filings into existing recent.json (by filingId). Default true when sinceDate is set. */
  mergeExisting?: boolean;
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

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return parseUsDateToIso(raw);
}

function isoToUsDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function isOnOrAfter(filingDate: string | null | undefined, sinceIso: string): boolean {
  const iso = toIsoDate(filingDate);
  return Boolean(iso && iso >= sinceIso);
}

function sortBundlesNewest(rows: PoliticianFilingBundle[]): PoliticianFilingBundle[] {
  return [...rows].sort((a, b) => {
    const ai = toIsoDate(a.filingDate) || "";
    const bi = toIsoDate(b.filingDate) || "";
    if (ai !== bi) return bi.localeCompare(ai);
    return String(b.filingId).localeCompare(String(a.filingId));
  });
}

function mergeBundles(
  existing: PoliticianFilingBundle[],
  incoming: PoliticianFilingBundle[]
): PoliticianFilingBundle[] {
  const byId = new Map<string, PoliticianFilingBundle>();
  for (const row of existing) {
    if (row?.filingId) byId.set(String(row.filingId), row);
  }
  for (const row of incoming) {
    if (row?.filingId) byId.set(String(row.filingId), row);
  }
  return sortBundlesNewest([...byId.values()]);
}

/** Resolve a since-date from an existing recent.json payload (fetchedAt day). */
export function sinceDateFromExisting(payload: PoliticiansRecentPayload | null): string | null {
  if (!payload?.fetchedAt) return null;
  return toIsoDate(payload.fetchedAt);
}

export async function fetchRecentPoliticianFilings(
  options: FetchRecentPoliticiansOptions = {}
): Promise<PoliticiansRecentPayload> {
  const limit = options.limit ?? 10;
  const houseYear = options.houseYear ?? new Date().getFullYear();
  const sinceDate = options.sinceDate ? toIsoDate(options.sinceDate) : null;
  const mergeExisting = options.mergeExisting ?? Boolean(sinceDate);
  const outPath = options.outPath ?? POLITICIANS_RECENT_PATH;
  const senate = new SenateEfdClient();
  const scrapeErrors: PoliticianScrapeError[] = [];

  const existing = mergeExisting ? readPoliticiansRecent(outPath) : null;
  const existingIds = new Set([
    ...(existing?.house || []).map((f) => String(f.filingId)),
    ...(existing?.senate || []).map((f) => String(f.filingId)),
  ]);

  const houseIndex = await fetchHouseFinancialIndex(houseYear);
  let houseCandidates = houseIndex.filter((e) => e.filingType === "P" && e.docId);
  houseCandidates = sortHousePtrFilingsNewest(houseCandidates);
  if (sinceDate) {
    houseCandidates = houseCandidates.filter((e) => isOnOrAfter(e.filingDate, sinceDate));
  } else {
    houseCandidates = houseCandidates.slice(0, limit);
  }
  // Skip filings we already have when doing incremental merge.
  if (sinceDate) {
    houseCandidates = houseCandidates.filter((e) => !existingIds.has(String(e.docId)));
  }

  const house: PoliticianFilingBundle[] = [];
  for (const [i, filing] of houseCandidates.entries()) {
    const name = summarizeHouseFiling(filing).name;
    process.stdout.write(
      `  [House ${i + 1}/${houseCandidates.length}] ${name} (${filing.filingDate}) … `
    );
    try {
      const trades = await fetchHousePtrTradesForFiling(filing);
      house.push(houseBundle(filing, trades));
      console.log(`${trades.length} trade(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${message}`);
      scrapeErrors.push({
        chamber: "house",
        politicianName: name,
        filingId: filing.docId,
        filingDate: filing.filingDate || null,
        message,
      });
    }
  }

  let senateRows: SenateSearchRow[] = [];
  try {
    if (sinceDate) {
      senateRows = await senate.listAllPtrFilings({
        fromDate: isoToUsDate(sinceDate),
        htmlOnly: true,
      });
      senateRows = senateRows.filter((row) => !existingIds.has(String(row.reportId)));
    } else {
      senateRows = await senate.listAllPtrFilings({ limit, htmlOnly: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nSenate PTR catalog failed (House data will still be saved): ${message}`);
    scrapeErrors.push({
      chamber: "senate",
      politicianName: "(catalog)",
      filingId: "catalog",
      filingDate: null,
      message,
    });
  }

  const senateOut: PoliticianFilingBundle[] = [];
  for (const [i, row] of senateRows.entries()) {
    const name = `${row.firstName} ${row.lastName}`.replace(/\s+/g, " ").trim();
    process.stdout.write(
      `  [Senate ${i + 1}/${senateRows.length}] ${name} (${row.reportDate || "?"}) … `
    );
    try {
      const trades = await senate.fetchPtrTrades(row);
      senateOut.push(senateBundle(row, trades));
      console.log(`${trades.length} trade(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${message}`);
      scrapeErrors.push({
        chamber: "senate",
        politicianName: name,
        filingId: row.reportId,
        filingDate: row.reportDate || null,
        sourceUrl: row.reportUrl,
        message,
      });
    }
  }

  const mergedHouse =
    mergeExisting && existing ? mergeBundles(existing.house || [], house) : house;
  const mergedSenate =
    mergeExisting && existing ? mergeBundles(existing.senate || [], senateOut) : senateOut;

  let payload: PoliticiansRecentPayload = {
    fetchedAt: new Date().toISOString(),
    limitPerChamber: sinceDate
      ? Math.max(mergedHouse.length, mergedSenate.length, limit)
      : limit,
    sinceDate,
    house: mergedHouse,
    senate: mergedSenate,
    scrapeErrors: scrapeErrors.length ? scrapeErrors : undefined,
  };

  if (options.enrichParty !== false) {
    const errors = payload.scrapeErrors;
    const since = payload.sinceDate;
    payload = await enrichPoliticiansRecent(payload, {
      forceRefreshRoster: options.forceRefreshPartyRoster,
    });
    payload.sinceDate = since;
    if (errors?.length) payload.scrapeErrors = errors;
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

function sanitizeTradeTicker(trade: PoliticianTrade): PoliticianTrade {
  let ticker = cleanPoliticianTicker(trade.ticker);
  if (!ticker) {
    ticker = cleanPoliticianTicker(trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/)?.[1]);
  }
  if (ticker === (trade.ticker || null)) return trade;
  return { ...trade, ticker };
}

function sanitizePoliticiansPayload(payload: PoliticiansRecentPayload): PoliticiansRecentPayload {
  const mapBundle = (bundle: PoliticianFilingBundle): PoliticianFilingBundle => ({
    ...bundle,
    trades: bundle.trades.map(sanitizeTradeTicker),
  });
  return {
    ...payload,
    house: payload.house.map(mapBundle),
    senate: payload.senate.map(mapBundle),
  };
}

export function readPoliticiansRecent(outPath = POLITICIANS_RECENT_PATH): PoliticiansRecentPayload | null {
  try {
    const raw = readFileSync(outPath, "utf8");
    const payload = JSON.parse(raw) as PoliticiansRecentPayload;
    return sanitizePoliticiansPayload(payload);
  } catch {
    return null;
  }
}
