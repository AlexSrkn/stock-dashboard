import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  convictionRoleLabel,
} from "../convictionBuys/roleWeights.js";
import { loadOpenMarketPurchasesAndSales, loadSharesOutstandingMap } from "./queries.js";
import {
  computeRepeatBuyerScore,
  currentPurchaseStreak,
  parseDateMs,
  percentileScores,
  repeatBuyerClassification,
  round1,
  round2,
} from "./score.js";
import type { RawOpenMarketTrade, RepeatBuyerRow, RepeatBuyersCachePayload } from "./types.js";

const MS_DAY = 86_400_000;
const MS_12M = 365 * MS_DAY;
const MS_24M = 730 * MS_DAY;

function groupKey(row: Pick<RawOpenMarketTrade, "ticker" | "insiderName">): string {
  return `${row.ticker}::${row.insiderName.trim().toLowerCase()}`;
}

function txTime(row: RawOpenMarketTrade): number {
  return parseDateMs(row.transactionDate) || parseDateMs(row.filingDate) || 0;
}

function sortChronological(a: RawOpenMarketTrade, b: RawOpenMarketTrade): number {
  const da = txTime(a);
  const db = txTime(b);
  if (da !== db) return da - db;
  return a.id - b.id;
}

interface GroupAgg {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  insiderName: string;
  title: string | null;
  buys: RawOpenMarketTrade[];
  codes: Array<"P" | "S">;
}

function buildGroups(trades: RawOpenMarketTrade[]): GroupAgg[] {
  const map = new Map<string, GroupAgg>();

  const sorted = [...trades].sort(sortChronological);
  for (const row of sorted) {
    const key = groupKey(row);
    let g = map.get(key);
    if (!g) {
      g = {
        ticker: row.ticker,
        companyName: row.companyName,
        sector: row.sector,
        insiderName: row.insiderName,
        title: row.insiderTitle,
        buys: [],
        codes: [],
      };
      map.set(key, g);
    }
    if (row.companyName && !g.companyName) g.companyName = row.companyName;
    if (row.sector && !g.sector) g.sector = row.sector;
    if (row.insiderTitle) g.title = row.insiderTitle;

    if (row.transactionCode === "P") {
      g.buys.push(row);
      g.codes.push("P");
    } else if (row.transactionCode === "S") {
      g.codes.push("S");
    }
  }

  return [...map.values()].filter((g) => g.buys.length >= 2);
}

export async function computeRepeatBuyers(
  pool: pg.Pool = getPool()
): Promise<RepeatBuyersCachePayload> {
  const [trades, sharesOutstanding] = await Promise.all([
    loadOpenMarketPurchasesAndSales(pool),
    loadSharesOutstandingMap(pool),
  ]);

  const groups = buildGroups(trades);
  const now = Date.now();

  const drafts = groups.map((g) => {
    const buyTimes = g.buys.map(txTime).filter((t) => t > 0);
    const firstMs = buyTimes.length ? Math.min(...buyTimes) : Number.NaN;
    const latestMs = buyTimes.length ? Math.max(...buyTimes) : Number.NaN;

    let purchasesLast12Months = 0;
    let purchasesLast24Months = 0;
    let totalShares = 0;
    let totalInvested = 0;
    for (const b of g.buys) {
      totalShares += b.shares;
      totalInvested += b.valueUsd;
      const t = txTime(b);
      if (t >= now - MS_12M) purchasesLast12Months += 1;
      if (t >= now - MS_24M) purchasesLast24Months += 1;
    }

    let averageDaysBetweenPurchases: number | null = null;
    if (buyTimes.length >= 2) {
      const ordered = [...buyTimes].sort((a, b) => a - b);
      let gapSum = 0;
      for (let i = 1; i < ordered.length; i++) {
        gapSum += (ordered[i] - ordered[i - 1]) / MS_DAY;
      }
      averageDaysBetweenPurchases = round2(gapSum / (ordered.length - 1));
    }

    const purchaseStreak = currentPurchaseStreak(g.codes);
    const purchaseCount = g.buys.length;
    const averagePurchaseSize = purchaseCount > 0 ? round2(totalInvested / purchaseCount) : 0;

    const lastBuy = g.buys.reduce((best, b) => (txTime(b) >= txTime(best) ? b : best), g.buys[0]);
    const px =
      lastBuy.pricePerShare != null && lastBuy.pricePerShare > 0
        ? lastBuy.pricePerShare
        : lastBuy.shares > 0
          ? lastBuy.valueUsd / lastBuy.shares
          : null;
    const so = sharesOutstanding.get(g.ticker);
    const marketCapUsd =
      so != null && px != null && px > 0 ? round2(so * px) : null;

    return {
      ticker: g.ticker,
      companyName: g.companyName,
      sector: g.sector,
      marketCapUsd,
      insiderName: g.insiderName,
      title: g.title,
      role: convictionRoleLabel(g.title),
      purchaseCount,
      purchasesLast12Months,
      purchasesLast24Months,
      purchaseStreak,
      totalShares: round2(totalShares),
      totalInvested: round2(totalInvested),
      averagePurchaseSize,
      averageDaysBetweenPurchases,
      firstPurchase: Number.isFinite(firstMs) ? new Date(firstMs).toISOString().slice(0, 10) : null,
      latestPurchase: Number.isFinite(latestMs) ? new Date(latestMs).toISOString().slice(0, 10) : null,
      avgDaysForScore: averageDaysBetweenPurchases,
    };
  });

  const countScores = percentileScores(drafts.map((d) => d.purchaseCount));
  const streakScores = percentileScores(drafts.map((d) => d.purchaseStreak));
  const investScores = percentileScores(drafts.map((d) => d.totalInvested));
  // Lower avg days → higher frequency: invert percentile of avg days (missing → worst).
  const avgDaysRaw = drafts.map((d) =>
    d.avgDaysForScore != null && d.avgDaysForScore > 0 ? d.avgDaysForScore : Number.POSITIVE_INFINITY
  );
  const avgDaysPct = percentileScores(
    avgDaysRaw.map((v) => (Number.isFinite(v) ? v : 1e12))
  );
  const frequencyScores = avgDaysPct.map((p) => 100 - p);

  const rows: RepeatBuyerRow[] = drafts.map((d, i) => {
    const purchaseCountScore = countScores[i] ?? 0;
    const streakScore = streakScores[i] ?? 0;
    const investmentScore = investScores[i] ?? 0;
    const frequencyScore = frequencyScores[i] ?? 0;
    const repeatBuyerScore = computeRepeatBuyerScore({
      purchaseCountScore,
      streakScore,
      investmentScore,
      frequencyScore,
    });

    return {
      ticker: d.ticker,
      companyName: d.companyName,
      sector: d.sector,
      marketCapUsd: d.marketCapUsd,
      insiderName: d.insiderName,
      title: d.title,
      role: d.role,
      purchaseCount: d.purchaseCount,
      purchasesLast12Months: d.purchasesLast12Months,
      purchasesLast24Months: d.purchasesLast24Months,
      purchaseStreak: d.purchaseStreak,
      totalShares: d.totalShares,
      totalInvested: d.totalInvested,
      averagePurchaseSize: d.averagePurchaseSize,
      averageDaysBetweenPurchases: d.averageDaysBetweenPurchases,
      firstPurchase: d.firstPurchase,
      latestPurchase: d.latestPurchase,
      repeatBuyerScore,
      classification: repeatBuyerClassification(repeatBuyerScore),
      purchaseCountScore: round1(purchaseCountScore),
      streakScore: round1(streakScore),
      investmentScore: round1(investmentScore),
      frequencyScore: round1(frequencyScore),
    };
  });

  rows.sort(
    (a, b) =>
      b.repeatBuyerScore - a.repeatBuyerScore ||
      b.purchaseCount - a.purchaseCount ||
      a.ticker.localeCompare(b.ticker)
  );

  const sectors = [
    ...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s))),
  ].sort((a, b) => a.localeCompare(b));

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    rows,
    sectors,
  };
}
