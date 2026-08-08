import type { HeavySellingClassification } from "./types.js";
import type { RawOpenMarketSell } from "./types.js";
import {
  DEFAULT_CLUSTER_MIN_SELLERS,
  DEFAULT_CLUSTER_WINDOW_DAYS,
  isExecutiveRole,
  resolveHeavySellingRole,
} from "./config.js";

export function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function percentileScores(values: number[]): number[] {
  const n = values.length;
  if (!n) return [];
  const indexed = values.map((v, i) => ({ v: Number.isFinite(v) ? v : 0, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array<number>(n).fill(0);
  if (n === 1) {
    out[0] = 50;
    return out;
  }
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + (j - 1)) / 2;
    const score = (avgRank / (n - 1)) * 100;
    for (let k = i; k < j; k++) out[indexed[k].i] = score;
    i = j;
  }
  return out;
}

export function computeHeavySellingScore(parts: {
  netDollarScore: number;
  uniqueSellersScore: number;
  executiveScore: number;
  clusterScore: number;
  largestSaleScore: number;
}): number {
  const raw =
    parts.netDollarScore * 0.35 +
    parts.uniqueSellersScore * 0.25 +
    parts.executiveScore * 0.2 +
    parts.clusterScore * 0.1 +
    parts.largestSaleScore * 0.1;
  return round1(clamp01to100(raw));
}

export function heavySellingClassification(score: number): HeavySellingClassification {
  if (score >= 85) return "Extreme Insider Selling";
  if (score >= 70) return "Heavy Selling";
  if (score >= 40) return "Elevated Selling";
  return "Normal Selling";
}

export function parseDateMs(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

export interface ClusterResult {
  clusterSize: number;
  clusterValueSold: number;
  clusterSharesSold: number;
  clusterExecutiveSellers: number;
  clusterSelling: boolean;
}

/**
 * Sliding window: max unique sellers in any `windowDays` span.
 * Also track dollars/shares/executives in that densest window.
 */
export function detectClusterSelling(
  sells: RawOpenMarketSell[],
  windowDays = DEFAULT_CLUSTER_WINDOW_DAYS,
  minSellers = DEFAULT_CLUSTER_MIN_SELLERS
): ClusterResult {
  const MS_DAY = 86_400_000;
  const windowMs = windowDays * MS_DAY;

  const events = sells
    .map((s) => {
      const t = parseDateMs(s.transactionDate) || parseDateMs(s.filingDate);
      if (!Number.isFinite(t) || t <= 0) return null;
      const role = resolveHeavySellingRole(s.insiderTitle);
      return {
        t,
        name: s.insiderName.trim().toLowerCase(),
        value: s.valueUsd,
        shares: s.shares,
        executive: isExecutiveRole(role),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e != null && Boolean(e.name))
    .sort((a, b) => a.t - b.t);

  if (!events.length) {
    return {
      clusterSize: 0,
      clusterValueSold: 0,
      clusterSharesSold: 0,
      clusterExecutiveSellers: 0,
      clusterSelling: false,
    };
  }

  let bestSize = 0;
  let bestValue = 0;
  let bestShares = 0;
  let bestExec = 0;

  let left = 0;
  const inWindow = new Map<string, { count: number; value: number; shares: number; executive: boolean }>();

  const add = (e: (typeof events)[0]) => {
    const cur = inWindow.get(e.name);
    if (cur) {
      cur.count += 1;
      cur.value += e.value;
      cur.shares += e.shares;
    } else {
      inWindow.set(e.name, {
        count: 1,
        value: e.value,
        shares: e.shares,
        executive: e.executive,
      });
    }
  };

  const remove = (e: (typeof events)[0]) => {
    const cur = inWindow.get(e.name);
    if (!cur) return;
    cur.count -= 1;
    cur.value -= e.value;
    cur.shares -= e.shares;
    if (cur.count <= 0) inWindow.delete(e.name);
  };

  for (let right = 0; right < events.length; right++) {
    add(events[right]);
    while (left <= right && events[right].t - events[left].t > windowMs) {
      remove(events[left]);
      left += 1;
    }
    const size = inWindow.size;
    if (size > bestSize) {
      bestSize = size;
      let value = 0;
      let shares = 0;
      let exec = 0;
      for (const v of inWindow.values()) {
        value += v.value;
        shares += v.shares;
        if (v.executive) exec += 1;
      }
      bestValue = value;
      bestShares = shares;
      bestExec = exec;
    }
  }

  return {
    clusterSize: bestSize,
    clusterValueSold: round2(bestValue),
    clusterSharesSold: round2(bestShares),
    clusterExecutiveSellers: bestExec,
    clusterSelling: bestSize >= minSellers,
  };
}

/** Map cluster size → 0–100 (3 sellers → ~50, 6+ → ~100). */
export function clusterSizeToScore(clusterSize: number, clusterSelling: boolean): number {
  if (!clusterSelling || clusterSize <= 0) return 0;
  return clamp01to100((clusterSize / 6) * 100);
}
