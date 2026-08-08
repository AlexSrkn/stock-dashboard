import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  DEFAULT_MIN_YEARS_SINCE_LAST_BUY,
  firstTimeBuyerRoleLabel,
  firstTimeBuyerRoleWeight,
} from "./config.js";
import { loadOpenMarketBuys, loadSharesOutstandingMap } from "./queries.js";
import {
  computeFirstTimeBuyerScore,
  firstTimeBuyerClassification,
  parseDateMs,
  percentileScores,
  roleScoreFromWeight,
  round1,
  round2,
  yearsBetween,
  yearsSinceLastBuyScore,
} from "./score.js";
import type {
  FirstTimeBuyerRow,
  FirstTimeBuyersCachePayload,
  RawOpenMarketBuy,
} from "./types.js";

function groupKey(row: Pick<RawOpenMarketBuy, "ticker" | "insiderName">): string {
  return `${row.ticker}::${row.insiderName.trim().toLowerCase()}`;
}

function txTime(row: RawOpenMarketBuy): number {
  return parseDateMs(row.transactionDate) || parseDateMs(row.filingDate) || 0;
}

function dateStr(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

interface QualifyingDraft {
  buy: RawOpenMarketBuy;
  yearsSinceLastBuy: number | null;
  previousBuyDate: string | null;
  historicalPurchaseCount: number;
  firstEverPurchase: boolean;
}

/**
 * Walk chronological buys per insider×ticker and keep trades that are
 * first-ever or follow a gap of at least `minYears` since the prior buy.
 */
export function detectFirstTimeBuyerTrades(
  buys: RawOpenMarketBuy[],
  minYears: number
): QualifyingDraft[] {
  const byKey = new Map<string, RawOpenMarketBuy[]>();
  for (const buy of buys) {
    const key = groupKey(buy);
    const list = byKey.get(key);
    if (list) list.push(buy);
    else byKey.set(key, [buy]);
  }

  const out: QualifyingDraft[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => {
      const da = txTime(a);
      const db = txTime(b);
      if (da !== db) return da - db;
      return a.id - b.id;
    });

    for (let i = 0; i < list.length; i++) {
      const buy = list[i];
      const t = txTime(buy);
      if (i === 0) {
        out.push({
          buy,
          yearsSinceLastBuy: null,
          previousBuyDate: null,
          historicalPurchaseCount: 0,
          firstEverPurchase: true,
        });
        continue;
      }
      const prev = list[i - 1];
      const prevT = txTime(prev);
      const years = yearsBetween(prevT, t || Date.now());
      if (years >= minYears) {
        out.push({
          buy,
          yearsSinceLastBuy: round2(years),
          previousBuyDate: dateStr(prevT) || prev.transactionDate || prev.filingDate,
          historicalPurchaseCount: i,
          firstEverPurchase: false,
        });
      }
    }
  }
  return out;
}

export async function computeFirstTimeBuyers(
  pool: pg.Pool = getPool(),
  opts: { minYears?: number } = {}
): Promise<FirstTimeBuyersCachePayload> {
  const minYears = opts.minYears ?? DEFAULT_MIN_YEARS_SINCE_LAST_BUY;
  const [buys, sharesOutstanding] = await Promise.all([
    loadOpenMarketBuys(pool),
    loadSharesOutstandingMap(pool),
  ]);

  const qualifying = detectFirstTimeBuyerTrades(buys, minYears);
  const valueScores = percentileScores(qualifying.map((q) => q.buy.valueUsd));
  const sharesScores = percentileScores(qualifying.map((q) => q.buy.shares));

  const rows: FirstTimeBuyerRow[] = qualifying.map((q, i) => {
    const { buy } = q;
    const roleWeight = firstTimeBuyerRoleWeight(buy.insiderTitle);
    const yearsScore = yearsSinceLastBuyScore(q.yearsSinceLastBuy, q.firstEverPurchase);
    const valueScore = valueScores[i] ?? 0;
    const roleScore = roleScoreFromWeight(roleWeight);
    const firstEverScore = q.firstEverPurchase ? 100 : 0;
    const sharesScore = sharesScores[i] ?? 0;
    const firstTimeBuyerScore = computeFirstTimeBuyerScore({
      yearsScore,
      valueScore,
      roleScore,
      firstEverScore,
      sharesScore,
    });

    const px =
      buy.pricePerShare != null && buy.pricePerShare > 0
        ? buy.pricePerShare
        : buy.shares > 0
          ? buy.valueUsd / buy.shares
          : null;
    const so = sharesOutstanding.get(buy.ticker);
    const marketCapUsd =
      so != null && px != null && px > 0 ? round2(so * px) : null;

    return {
      id: buy.id,
      ticker: buy.ticker,
      companyName: buy.companyName,
      sector: buy.sector,
      marketCapUsd,
      insiderName: buy.insiderName,
      title: buy.insiderTitle,
      role: firstTimeBuyerRoleLabel(buy.insiderTitle),
      filingDate: buy.filingDate,
      transactionDate: buy.transactionDate,
      shares: round2(buy.shares),
      pricePerShare: buy.pricePerShare != null ? round2(buy.pricePerShare) : null,
      purchaseValue: round2(buy.valueUsd),
      yearsSinceLastBuy: q.yearsSinceLastBuy,
      previousBuyDate: q.previousBuyDate,
      historicalPurchaseCount: q.historicalPurchaseCount,
      firstEverPurchase: q.firstEverPurchase,
      firstTimeBuyerScore,
      classification: firstTimeBuyerClassification(firstTimeBuyerScore),
      yearsScore: round1(yearsScore),
      valueScore: round1(valueScore),
      roleScore: round1(roleScore),
      firstEverScore: round1(firstEverScore),
      sharesScore: round1(sharesScore),
      roleWeight,
    };
  });

  rows.sort(
    (a, b) =>
      b.firstTimeBuyerScore - a.firstTimeBuyerScore ||
      b.purchaseValue - a.purchaseValue ||
      a.ticker.localeCompare(b.ticker)
  );

  const sectors = [
    ...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s))),
  ].sort((a, b) => a.localeCompare(b));

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    minYearsThreshold: minYears,
    rows,
    sectors,
  };
}
