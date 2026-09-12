import type { InsiderBuyRow } from "./types.js";

/** Drop Form 4 buy rows whose price is wildly above the ticker's median (bad parses). */
const PRICE_MEDIAN_MULTIPLIER = 20;
/** When median price is under $5, reject prints above this absolute level. */
const PENNY_ABSURD_PRICE = 50;
const MIN_PRICES_FOR_MEDIAN = 3;

function impliedPrice(row: InsiderBuyRow): number | null {
  const listed = Number(row.pricePerShare);
  if (Number.isFinite(listed) && listed > 0) return listed;
  const shares = Number(row.shares);
  const value = Number(row.transactionValue);
  if (Number.isFinite(shares) && shares > 0 && Number.isFinite(value) && value > 0) {
    return value / shares;
  }
  return null;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function filterOutlierInsiderBuys(rows: InsiderBuyRow[]): InsiderBuyRow[] {
  const byTicker = new Map<string, InsiderBuyRow[]>();
  for (const row of rows) {
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!ticker) continue;
    let group = byTicker.get(ticker);
    if (!group) {
      group = [];
      byTicker.set(ticker, group);
    }
    group.push(row);
  }

  const out: InsiderBuyRow[] = [];
  for (const group of byTicker.values()) {
    const prices = group
      .map(impliedPrice)
      .filter((p): p is number => p != null && Number.isFinite(p) && p > 0)
      .sort((a, b) => a - b);
    const med = prices.length >= MIN_PRICES_FOR_MEDIAN ? median(prices) : null;

    for (const row of group) {
      const price = impliedPrice(row);
      if (med != null && price != null) {
        if (price > med * PRICE_MEDIAN_MULTIPLIER) continue;
        if (med < 5 && price > PENNY_ABSURD_PRICE) continue;
      }
      out.push(row);
    }
  }
  return out;
}
