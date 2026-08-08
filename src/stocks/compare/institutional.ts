import type pg from "pg";
import {
  getNewPositions,
  getOwnershipChanges,
  getSoldOut,
  getTopHolders,
} from "../../ownership/ownershipAnalytics.js";
import { getCachedOwnershipHistory } from "../ownershipHistory/cache.js";
import type { CompareInstitutional, CompareTopHolder } from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumHolderValues(holders: { valueUsd: number | null }[]): number | null {
  let sum = 0;
  let any = false;
  for (const h of holders) {
    const v = Number(h.valueUsd);
    if (Number.isFinite(v) && v > 0) {
      sum += v;
      any = true;
    }
  }
  return any ? round2(sum) : null;
}

export async function buildInstitutionalSide(
  pool: pg.Pool,
  ticker: string
): Promise<CompareInstitutional> {
  const sym = String(ticker).trim().toUpperCase();
  try {
    const [top, news, sold, changes] = await Promise.all([
      getTopHolders(pool, sym, { limit: 200 }),
      getNewPositions(pool, sym, { limit: 500 }),
      getSoldOut(pool, sym, { limit: 500 }),
      getOwnershipChanges(pool, sym, { limit: 500 }),
    ]);

    const history = getCachedOwnershipHistory();
    const histQuarter = history?.currentQuarter || "";
    const histRow = histQuarter
      ? history?.byQuarter?.[histQuarter]?.find((r) => String(r.ticker).toUpperCase() === sym)
      : undefined;

    const increasing = changes.changes.filter((c) => c.sharesChange > 0).length;
    const decreasing = changes.changes.filter((c) => c.sharesChange < 0).length;
    const holderValueTotal = sumHolderValues(top.holders);
    const topHolders: CompareTopHolder[] = top.holders.slice(0, 15).map((h, i) => ({
      rank: i + 1,
      institution: h.fundName,
      filerCik: h.filerCik ?? null,
      portfolioWeight:
        holderValueTotal && h.valueUsd != null && holderValueTotal > 0
          ? round2((h.valueUsd / holderValueTotal) * 100)
          : null,
      shares: h.shares,
      valueUsd: h.valueUsd,
      qoqChangePct: h.sharesChangePct ?? null,
    }));
    // Keep a wider holder list for overlap (still filing-based tracked institutions).
    const holdersForOverlap: CompareTopHolder[] = top.holders.map((h, i) => ({
      rank: i + 1,
      institution: h.fundName,
      filerCik: h.filerCik ?? null,
      portfolioWeight:
        holderValueTotal && h.valueUsd != null && holderValueTotal > 0
          ? round2((h.valueUsd / holderValueTotal) * 100)
          : null,
      shares: h.shares,
      valueUsd: h.valueUsd,
      qoqChangePct: h.sharesChangePct ?? null,
    }));

    const holderCount =
      histRow?.currentHolderCount ??
      (top.holders.length > 0 ? top.holders.length : null);
    const available =
      Boolean(top.meta.currentQuarter) ||
      top.holders.length > 0 ||
      Boolean(histRow);

    return {
      holderCount,
      newPositions: news.positions.length,
      increasingPositions: increasing,
      decreasingPositions: decreasing,
      exitedPositions: sold.positions.length,
      ownershipPercentage: histRow?.currentInstitutionalOwnership ?? null,
      ownershipChange: histRow?.ownershipChange ?? null,
      total13fValue: histRow?.totalInstitutionalValueUsd ?? holderValueTotal,
      latestQuarter: top.meta.currentQuarter || histRow?.currentQuarter || null,
      previousQuarter: top.meta.previousQuarter || histRow?.previousQuarter || null,
      topHolders,
      holdersForOverlap,
      available,
    };
  } catch {
    return emptyInstitutional();
  }
}

function emptyInstitutional(): CompareInstitutional {
  return {
    holderCount: null,
    newPositions: null,
    increasingPositions: null,
    decreasingPositions: null,
    exitedPositions: null,
    ownershipPercentage: null,
    ownershipChange: null,
    total13fValue: null,
    latestQuarter: null,
    previousQuarter: null,
    topHolders: [],
    holdersForOverlap: [],
    available: false,
  };
}

export function buildInstitutionOverlap(
  a: CompareInstitutional,
  b: CompareInstitutional
): {
  count: number;
  items: {
    cik: string;
    name: string;
    weightA: number | null;
    weightB: number | null;
    sharesA: number | null;
    sharesB: number | null;
    valueA: number | null;
    valueB: number | null;
  }[];
} {
  const listA = a.holdersForOverlap?.length ? a.holdersForOverlap : a.topHolders;
  const listB = b.holdersForOverlap?.length ? b.holdersForOverlap : b.topHolders;
  const mapA = new Map<string, (typeof listA)[0]>();
  for (const h of listA) {
    const key = h.filerCik || h.institution.toLowerCase();
    mapA.set(key, h);
  }
  const items = [];
  for (const h of listB) {
    const key = h.filerCik || h.institution.toLowerCase();
    const other = mapA.get(key);
    if (!other) continue;
    items.push({
      cik: h.filerCik || other.filerCik || "",
      name: other.institution || h.institution,
      weightA: other.portfolioWeight,
      weightB: h.portfolioWeight,
      sharesA: other.shares,
      sharesB: h.shares,
      valueA: other.valueUsd,
      valueB: h.valueUsd,
    });
  }

  // Also match by name when CIK missing
  if (items.length < 3) {
    const byNameA = new Map(listA.map((h) => [h.institution.toLowerCase(), h]));
    for (const h of listB) {
      const other = byNameA.get(h.institution.toLowerCase());
      if (!other) continue;
      if (items.some((x) => x.name.toLowerCase() === h.institution.toLowerCase())) continue;
      items.push({
        cik: h.filerCik || other.filerCik || "",
        name: h.institution,
        weightA: other.portfolioWeight,
        weightB: h.portfolioWeight,
        sharesA: other.shares,
        sharesB: h.shares,
        valueA: other.valueUsd,
        valueB: h.valueUsd,
      });
    }
  }

  items.sort(
    (x, y) =>
      (y.valueA ?? 0) + (y.valueB ?? 0) - ((x.valueA ?? 0) + (x.valueB ?? 0))
  );
  return { count: items.length, items: items.slice(0, 40) };
}
