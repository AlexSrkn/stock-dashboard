/**
 * SEC 13F <value> is officially in thousands of USD. This database mixes:
 *   - older rows: thousands stored as-is (e.g. 41378 → $41.378M)
 *   - newer rows: already expanded to dollars (e.g. 43731643 → $43.7M)
 *
 * Detect thousands by implied price = value / shares. Common-stock rows with
 * hundreds of shares and implied price < $1 are almost always still in thousands.
 */

/** Implied $/share below this ⇒ treat `value` as SEC thousands and ×1000. */
export const THIRTEEN_F_THOUSANDS_PRICE_CEILING = 1;

/** Need enough shares so tiny lots / odd lots do not flip the unit guess. */
export const THIRTEEN_F_UNIT_DETECT_MIN_SHARES = 100;

export function thirteenFValueLooksLikeThousands(
  value: number,
  shares: number | null | undefined
): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const sh = Number(shares);
  if (!Number.isFinite(sh) || sh < THIRTEEN_F_UNIT_DETECT_MIN_SHARES) return false;
  return value / sh < THIRTEEN_F_THOUSANDS_PRICE_CEILING;
}

/** Convert a single holding value field to USD dollars. */
export function normalizeThirteenFHoldingUsd(
  value: number | null | undefined,
  shares: number | null | undefined
): number {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return thirteenFValueLooksLikeThousands(v, shares) ? v * 1000 : v;
}

/**
 * Scale a portfolio-value time series when adjacent quarters jump by ~1000×
 * with a stable holdings count (ingest unit change, not real AUM change).
 * Canonical unit is dollars (the larger scale).
 */
export function normalizePortfolioValueSeriesUnits<
  T extends { portfolioValueUsd: number; holdingsCount: number },
>(points: T[]): T[] {
  if (points.length < 2) return points;
  const out = points.map((p) => ({ ...p }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (!(prev.portfolioValueUsd > 0) || !(cur.portfolioValueUsd > 0)) continue;
    const ratio = cur.portfolioValueUsd / prev.portfolioValueUsd;
    const hcPrev = Math.max(1, prev.holdingsCount);
    const hcCur = Math.max(1, cur.holdingsCount);
    const hcStable =
      Math.min(hcPrev, hcCur) / Math.max(hcPrev, hcCur) >= 0.5;
    if (!hcStable) continue;

    if (ratio >= 800 && ratio <= 1200) {
      // Earlier segment was in thousands — scale all prior points up.
      for (let j = 0; j < i; j++) {
        out[j] = {
          ...out[j]!,
          portfolioValueUsd: out[j]!.portfolioValueUsd * 1000,
        };
      }
    } else if (ratio >= 1 / 1200 && ratio <= 1 / 800) {
      // Current (and later will follow) dropped to thousands — scale current up.
      out[i] = {
        ...cur,
        portfolioValueUsd: cur.portfolioValueUsd * 1000,
      };
    }
  }
  return out;
}
