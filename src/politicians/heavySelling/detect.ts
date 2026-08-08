/**
 * Consecutive sell streaks on a chronological buy/sell timeline.
 * Each sell increments the active run; each buy closes it into previous and resets.
 */
export function saleStreaks(codesChronological: ReadonlyArray<"buy" | "sell">): {
  current: number;
  previous: number;
} {
  let current = 0;
  let previous = 0;
  for (const code of codesChronological) {
    if (code === "sell") {
      current += 1;
    } else {
      if (current > 0) previous = current;
      current = 0;
    }
  }
  return { current, previous };
}

export function currentSaleStreak(
  codesChronological: ReadonlyArray<"buy" | "sell">
): number {
  return saleStreaks(codesChronological).current;
}

export interface MultipleSellerEvent {
  politicianKey: string;
  dateMs: number;
  estimatedValue: number;
  party: string | null;
  chamber: "house" | "senate";
}

/**
 * Sliding window: max unique politician sellers within `windowDays`.
 * `multipleSellers` is true when that peak is >= `minSellers`.
 */
export function detectMultiplePoliticianSellers(
  events: MultipleSellerEvent[],
  windowDays: number,
  minSellers: number
): {
  multipleSellers: boolean;
  peakUniqueSellers: number;
  peakEstimatedValue: number;
  democratSellers: number;
  republicanSellers: number;
  independentSellers: number;
  senatorSellers: number;
  representativeSellers: number;
} {
  const MS_DAY = 86_400_000;
  const windowMs = Math.max(1, windowDays) * MS_DAY;
  const sorted = [...events]
    .filter((e) => Number.isFinite(e.dateMs) && e.dateMs > 0 && e.politicianKey)
    .sort((a, b) => a.dateMs - b.dateMs);

  if (!sorted.length) {
    return {
      multipleSellers: false,
      peakUniqueSellers: 0,
      peakEstimatedValue: 0,
      democratSellers: 0,
      republicanSellers: 0,
      independentSellers: 0,
      senatorSellers: 0,
      representativeSellers: 0,
    };
  }

  let left = 0;
  let bestSize = 0;
  let bestValue = 0;
  let bestKeys = new Set<string>();
  const counts = new Map<string, number>();
  const valueByKey = new Map<string, number>();
  const metaByKey = new Map<string, { party: string | null; chamber: "house" | "senate" }>();

  const add = (e: MultipleSellerEvent) => {
    counts.set(e.politicianKey, (counts.get(e.politicianKey) || 0) + 1);
    valueByKey.set(e.politicianKey, (valueByKey.get(e.politicianKey) || 0) + e.estimatedValue);
    metaByKey.set(e.politicianKey, { party: e.party, chamber: e.chamber });
  };

  const remove = (e: MultipleSellerEvent) => {
    const c = (counts.get(e.politicianKey) || 0) - 1;
    if (c <= 0) {
      counts.delete(e.politicianKey);
      valueByKey.delete(e.politicianKey);
    } else {
      counts.set(e.politicianKey, c);
      valueByKey.set(
        e.politicianKey,
        Math.max(0, (valueByKey.get(e.politicianKey) || 0) - e.estimatedValue)
      );
    }
  };

  for (let right = 0; right < sorted.length; right++) {
    add(sorted[right]!);
    while (left <= right && sorted[right]!.dateMs - sorted[left]!.dateMs > windowMs) {
      remove(sorted[left]!);
      left += 1;
    }
    const size = counts.size;
    if (size > bestSize) {
      bestSize = size;
      bestKeys = new Set(counts.keys());
      bestValue = 0;
      for (const v of valueByKey.values()) bestValue += v;
    }
  }

  let democratSellers = 0;
  let republicanSellers = 0;
  let independentSellers = 0;
  let senatorSellers = 0;
  let representativeSellers = 0;
  for (const key of bestKeys) {
    const meta = metaByKey.get(key);
    if (!meta) continue;
    const party = String(meta.party || "").toLowerCase();
    if (party.includes("democrat")) democratSellers += 1;
    else if (party.includes("republican")) republicanSellers += 1;
    else if (party.includes("independent") || party) independentSellers += 1;
    if (meta.chamber === "senate") senatorSellers += 1;
    else representativeSellers += 1;
  }

  return {
    multipleSellers: bestSize >= minSellers,
    peakUniqueSellers: bestSize,
    peakEstimatedValue: bestValue,
    democratSellers,
    republicanSellers,
    independentSellers,
    senatorSellers,
    representativeSellers,
  };
}
