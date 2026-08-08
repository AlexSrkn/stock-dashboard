import { getCachedInsiderClusterForTicker } from "../../insiderCluster/cache.js";
import { getCachedFirstTimeBuyers } from "../../insider/firstTimeBuyers/cache.js";
import { getCachedHeavySelling } from "../../insider/heavySelling/cache.js";
import { getCachedRepeatBuyers } from "../../insider/repeatBuyers/cache.js";
import { getCachedInsiderSentiment } from "../../insider/sentiment/cache.js";
import { getCongressTradesForTicker, isCongressBuy, isCongressSell } from "../../politicians/byTicker.js";
import { politicianKey } from "../../politicians/politicianKey.js";
import { estimatedValue } from "../../politicians/heavySelling/dates.js";
import { getCachedConflictSignals } from "../../signals/conflictSignals/cache.js";
import { getCachedConvictionScore } from "../../signals/convictionScore/cache.js";
import { getCachedDoubleSignal } from "../../signals/doubleSignal/cache.js";
import { getCachedHiddenGems } from "../../signals/hiddenGems/cache.js";
import { getCachedInstitutionalDiscovery } from "../../signals/institutionalDiscovery/cache.js";
import type { InstitutionalDiscoveryRow } from "../../signals/institutionalDiscovery/types.js";
import { getCachedTripleSignal } from "../../signals/tripleSignal/cache.js";
import { getCachedOwnershipHistory } from "../../stocks/ownershipHistory/cache.js";
import type { ProfileMetrics } from "./score.js";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function tickerIn(list: { ticker: string }[] | undefined, ticker: string): boolean {
  const sym = ticker.toUpperCase();
  return Boolean(list?.some((r) => String(r.ticker).toUpperCase() === sym));
}

function discoveryByTicker(): Map<string, InstitutionalDiscoveryRow> {
  const map = new Map<string, InstitutionalDiscoveryRow>();
  const cache = getCachedInstitutionalDiscovery();
  for (const row of cache?.signals || []) {
    if (!row?.ticker) continue;
    map.set(String(row.ticker).toUpperCase(), row);
  }
  return map;
}

function ownershipPctByTicker(): Map<string, number> {
  const map = new Map<string, number>();
  const hist = getCachedOwnershipHistory();
  const q = hist?.currentQuarter;
  if (!hist || !q) return map;
  for (const row of hist.byQuarter[q] || []) {
    if (row?.ticker && finite(row.currentInstitutionalOwnership)) {
      map.set(String(row.ticker).toUpperCase(), row.currentInstitutionalOwnership);
    }
  }
  return map;
}

function sentimentByTicker(): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of getCachedInsiderSentiment()?.rows || []) {
    if (row?.ticker && finite(row.sentimentScore)) {
      map.set(String(row.ticker).toUpperCase(), row.sentimentScore);
    }
  }
  return map;
}

function convictionByTicker(): Map<string, number> {
  const map = new Map<string, number>();
  const cache = getCachedConvictionScore();
  const preferred = cache?.currentQuarter;
  for (const row of cache?.signals || []) {
    if (!row?.ticker || row.insufficientData || !finite(row.convictionScore)) continue;
    const sym = String(row.ticker).toUpperCase();
    if (preferred && row.quarter === preferred) {
      map.set(sym, row.convictionScore!);
      continue;
    }
    if (!map.has(sym)) map.set(sym, row.convictionScore!);
  }
  return map;
}

function signalSets() {
  return {
    double90: new Set(
      (getCachedDoubleSignal(90)?.signals || []).map((s) => String(s.ticker).toUpperCase())
    ),
    triple90: new Set(
      (getCachedTripleSignal(90)?.signals || []).map((s) => String(s.ticker).toUpperCase())
    ),
    gems: new Set(
      (getCachedHiddenGems()?.signals || []).map((s) => String(s.ticker).toUpperCase())
    ),
    conflicts: new Set(
      (getCachedConflictSignals()?.signals || []).map((s) => String(s.ticker).toUpperCase())
    ),
  };
}

function politicianFlags(ticker: string): Pick<
  ProfileMetrics,
  | "politicianHeavyBuying"
  | "politicianHeavySelling"
  | "politicianRepeatBuyers"
  | "politicianFirstTimeBuyers"
  | "hasPoliticianActivity"
> {
  const { trades } = getCongressTradesForTicker(ticker);
  if (!trades.length) {
    return {
      politicianHeavyBuying: null,
      politicianHeavySelling: null,
      politicianRepeatBuyers: null,
      politicianFirstTimeBuyers: null,
      hasPoliticianActivity: false,
    };
  }
  const buys = trades.filter(isCongressBuy);
  const sells = trades.filter(isCongressSell);
  const buysByKey = new Map<string, number>();
  for (const t of buys) {
    const k = t.politicianKey || politicianKey(t.politicianName);
    if (!k) continue;
    buysByKey.set(k, (buysByKey.get(k) || 0) + 1);
  }
  const sellsByKey = new Map<string, { n: number; v: number }>();
  for (const t of sells) {
    const k = t.politicianKey || politicianKey(t.politicianName);
    if (!k) continue;
    const prev = sellsByKey.get(k) || { n: 0, v: 0 };
    prev.n += 1;
    prev.v += estimatedValue(t.amountMin, t.amountMax);
    sellsByKey.set(k, prev);
  }
  return {
    politicianHeavyBuying: [...buysByKey.values()].some((n) => n >= 3),
    politicianHeavySelling: [...sellsByKey.values()].some((x) => x.n >= 2 || x.v >= 50_000),
    politicianRepeatBuyers: [...buysByKey.values()].some((n) => n >= 2),
    politicianFirstTimeBuyers: [...buysByKey.values()].some((n) => n === 1),
    hasPoliticianActivity: true,
  };
}

export interface SimilarStocksLookups {
  discovery: Map<string, InstitutionalDiscoveryRow>;
  ownershipPct: Map<string, number>;
  sentiment: Map<string, number>;
  conviction: Map<string, number>;
  signals: ReturnType<typeof signalSets>;
  repeatBuyers: Set<string>;
  firstTimeBuyers: Set<string>;
  heavySelling: Set<string>;
}

export function buildSimilarStocksLookups(): SimilarStocksLookups {
  return {
    discovery: discoveryByTicker(),
    ownershipPct: ownershipPctByTicker(),
    sentiment: sentimentByTicker(),
    conviction: convictionByTicker(),
    signals: signalSets(),
    repeatBuyers: new Set(
      (getCachedRepeatBuyers()?.rows || []).map((r) => String(r.ticker).toUpperCase())
    ),
    firstTimeBuyers: new Set(
      (getCachedFirstTimeBuyers()?.rows || []).map((r) => String(r.ticker).toUpperCase())
    ),
    heavySelling: new Set(
      (getCachedHeavySelling()?.rows || []).map((r) => String(r.ticker).toUpperCase())
    ),
  };
}

export function buildTickerProfile(
  tickerRaw: string,
  lookups: SimilarStocksLookups
): ProfileMetrics {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  const discovery = lookups.discovery.get(ticker);
  const cluster = getCachedInsiderClusterForTicker(ticker, 90);
  const doubleSignal = lookups.signals.double90.has(ticker);
  const tripleSignal = lookups.signals.triple90.has(ticker);
  const hiddenGem = lookups.signals.gems.has(ticker);
  const conflictSignal = lookups.signals.conflicts.has(ticker);
  const repeatBuyers = lookups.repeatBuyers.has(ticker);
  const heavySelling = lookups.heavySelling.has(ticker);
  const sentiment = lookups.sentiment.get(ticker) ?? null;
  const politician = politicianFlags(ticker);

  const hasInsiderActivity =
    sentiment != null ||
    repeatBuyers ||
    heavySelling ||
    Boolean(cluster) ||
    tickerIn(getCachedFirstTimeBuyers()?.rows, ticker);

  const hasActiveSignals =
    doubleSignal ||
    tripleSignal ||
    hiddenGem ||
    conflictSignal ||
    finite(lookups.conviction.get(ticker));

  return {
    ownershipPct: lookups.ownershipPct.get(ticker) ?? discovery?.institutionalOwnershipPercent ?? null,
    holderCount: discovery?.currentHolderCount ?? null,
    holderGrowthPct: discovery?.holderGrowthPercent ?? null,
    discoveryScore: discovery?.discoveryScore ?? null,
    newHolderCount: discovery?.newHolderCount ?? null,
    exitedHolderCount: discovery?.exitedHolderCount ?? null,
    netHolderChange: discovery?.netHolderChange ?? null,
    ownershipChangePct: discovery?.ownershipChangePercent ?? null,
    convictionScore: lookups.conviction.get(ticker) ?? null,
    insiderSentiment: sentiment,
    clusterBuying:
      cluster != null ? Boolean(cluster.clusterAlert || cluster.buyerCount >= 3) : null,
    heavySelling: heavySelling || null,
    repeatBuyers: repeatBuyers || null,
    ...politician,
    doubleSignal,
    tripleSignal,
    hiddenGem,
    conflictSignal,
    hasInsiderActivity,
    hasPoliticianActivity: politician.hasPoliticianActivity,
    hasActiveSignals,
  };
}

export function activeSignalLabelsForProfile(profile: ProfileMetrics): string[] {
  const out: string[] = [];
  if (profile.doubleSignal) out.push("Double Signal");
  if (profile.tripleSignal) out.push("Triple Signal");
  if (profile.hiddenGem) out.push("Hidden Gem");
  if (profile.conflictSignal) out.push("Conflict Signal");
  if (finite(profile.convictionScore)) out.push("Conviction Score");
  if (finite(profile.discoveryScore)) out.push("Institutional Discovery");
  return out;
}
