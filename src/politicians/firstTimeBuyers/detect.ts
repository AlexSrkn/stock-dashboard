import { DEFAULT_MIN_YEARS_SINCE_LAST_BUY } from "./config.js";
import { parseDateMs, round2, toIsoDate, yearsBetween } from "./dates.js";

export interface RawPoliticianBuy {
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  state: string | null;
  party: string | null;
  ticker: string;
  assetName: string | null;
  transactionDate: string | null;
  disclosureDate: string | null;
  dateMs: number;
  estimatedValue: number;
}

export interface DetectedFirstTimeBuy {
  buy: RawPoliticianBuy;
  firstRecordedPurchase: boolean;
  previousBuyDate: string | null;
  yearsSinceLastBuy: number | null;
  previousBuyCount: number;
  totalHistoricalBuyCount: number;
  firstPurchaseDate: string | null;
  latestPurchaseDate: string | null;
}

function groupKey(row: Pick<RawPoliticianBuy, "ticker" | "politicianKey">): string {
  return `${row.ticker}::${row.politicianKey}`;
}

/**
 * Walk chronological buys per politician×ticker. Each buy qualifies when it is
 * the first recorded purchase or follows a gap of at least `minYears`.
 */
export function detectPoliticianFirstTimeBuys(
  buys: RawPoliticianBuy[],
  minYears: number = DEFAULT_MIN_YEARS_SINCE_LAST_BUY
): DetectedFirstTimeBuy[] {
  const byKey = new Map<string, RawPoliticianBuy[]>();
  for (const buy of buys) {
    const key = groupKey(buy);
    const list = byKey.get(key);
    if (list) list.push(buy);
    else byKey.set(key, [buy]);
  }

  const out: DetectedFirstTimeBuy[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => {
      if (a.dateMs !== b.dateMs) return a.dateMs - b.dateMs;
      return a.politicianKey.localeCompare(b.politicianKey);
    });

    const firstMs = list[0]?.dateMs ?? Number.NaN;
    const latestMs = list[list.length - 1]?.dateMs ?? Number.NaN;
    const firstPurchaseDate = toIsoDate(firstMs);
    const latestPurchaseDate = toIsoDate(latestMs);

    for (let i = 0; i < list.length; i++) {
      const buy = list[i];
      const t = buy.dateMs;
      if (i === 0) {
        out.push({
          buy,
          firstRecordedPurchase: true,
          previousBuyDate: null,
          yearsSinceLastBuy: null,
          previousBuyCount: 0,
          totalHistoricalBuyCount: list.length,
          firstPurchaseDate,
          latestPurchaseDate,
        });
        continue;
      }
      const prev = list[i - 1];
      const prevT = prev.dateMs;
      const years = yearsBetween(prevT, t || Date.now());
      if (Number.isFinite(years) && years >= minYears) {
        out.push({
          buy,
          firstRecordedPurchase: false,
          previousBuyDate: toIsoDate(prevT) || prev.transactionDate,
          yearsSinceLastBuy: round2(years),
          previousBuyCount: i,
          totalHistoricalBuyCount: list.length,
          firstPurchaseDate,
          latestPurchaseDate,
        });
      }
    }
  }

  return out;
}
