import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  DEFAULT_CLUSTER_WINDOW_DAYS,
  isExecutiveRole,
  resolveHeavySellingRole,
} from "./config.js";
import { loadOpenMarketSells, loadSharesOutstandingMap } from "./queries.js";
import {
  clusterSizeToScore,
  computeHeavySellingScore,
  detectClusterSelling,
  heavySellingClassification,
  parseDateMs,
  percentileScores,
  round1,
  round2,
} from "./score.js";
import type {
  HeavySellingCachePayload,
  HeavySellingRow,
  RawOpenMarketSell,
  RoleSaleCounts,
} from "./types.js";

function emptyRoleCounts(): RoleSaleCounts {
  return {
    CEO: 0,
    Founder: 0,
    Chairman: 0,
    CFO: 0,
    President: 0,
    Officer: 0,
    Director: 0,
  };
}

function dateStr(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function computeHeavySelling(
  pool: pg.Pool = getPool(),
  opts: {
    dateFrom?: string | null;
    dateTo?: string | null;
    clusterWindowDays?: number;
  } = {}
): Promise<HeavySellingCachePayload> {
  const clusterWindowDays = opts.clusterWindowDays ?? DEFAULT_CLUSTER_WINDOW_DAYS;
  const [sells, sharesOutstanding] = await Promise.all([
    loadOpenMarketSells(pool, { dateFrom: opts.dateFrom, dateTo: opts.dateTo }),
    loadSharesOutstandingMap(pool),
  ]);

  const byTicker = new Map<string, RawOpenMarketSell[]>();
  for (const s of sells) {
    const list = byTicker.get(s.ticker);
    if (list) list.push(s);
    else byTicker.set(s.ticker, [s]);
  }

  const drafts: Array<Omit<HeavySellingRow, "heavySellingScore" | "classification"> & {
    lastPx: number | null;
  }> = [];

  for (const [ticker, list] of byTicker) {
    const sellers = new Map<string, { role: string; executive: boolean }>();
    const roleCounts = emptyRoleCounts();
    let totalTx = 0;
    let sharesSold = 0;
    let valueSold = 0;
    let largestSale = 0;
    let largestSaleInsider: string | null = null;
    let largestSaleDate: string | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    let companyName: string | null = null;
    let sector: string | null = null;
    let lastPx: number | null = null;

    for (const s of list) {
      totalTx += 1;
      sharesSold += s.shares;
      valueSold += s.valueUsd;
      if (s.companyName && !companyName) companyName = s.companyName;
      if (s.sector && !sector) sector = s.sector;

      const role = resolveHeavySellingRole(s.insiderTitle);
      const nameKey = s.insiderName.trim().toLowerCase();
      if (nameKey && !sellers.has(nameKey)) {
        sellers.set(nameKey, { role, executive: isExecutiveRole(role) });
      }
      if (role in roleCounts) {
        (roleCounts as Record<string, number>)[role] += 1;
      }

      if (s.valueUsd > largestSale) {
        largestSale = s.valueUsd;
        largestSaleInsider = s.insiderName;
        const t = parseDateMs(s.transactionDate) || parseDateMs(s.filingDate);
        largestSaleDate = dateStr(t) || s.transactionDate || s.filingDate;
      }

      const t = parseDateMs(s.transactionDate) || parseDateMs(s.filingDate);
      if (t > latestMs) {
        latestMs = t;
        lastPx =
          s.pricePerShare != null && s.pricePerShare > 0
            ? s.pricePerShare
            : s.shares > 0
              ? s.valueUsd / s.shares
              : lastPx;
      }
    }

    let executiveSellers = 0;
    for (const v of sellers.values()) {
      if (v.executive) executiveSellers += 1;
    }

    const cluster = detectClusterSelling(list, clusterWindowDays);
    const so = sharesOutstanding.get(ticker);
    const marketCapUsd =
      so != null && lastPx != null && lastPx > 0 ? round2(so * lastPx) : null;

    drafts.push({
      ticker,
      companyName,
      sector,
      marketCapUsd,
      totalSellTransactions: totalTx,
      uniqueSellers: sellers.size,
      executiveSellers,
      sharesSold: round2(sharesSold),
      valueSold: round2(valueSold),
      averageSaleSize: totalTx > 0 ? round2(valueSold / totalTx) : 0,
      largestSale: round2(largestSale),
      largestSaleInsider,
      largestSaleDate,
      netInsiderSelling: round2(valueSold),
      clusterSelling: cluster.clusterSelling,
      clusterSize: cluster.clusterSize,
      clusterValueSold: cluster.clusterValueSold,
      clusterSharesSold: cluster.clusterSharesSold,
      clusterExecutiveSellers: cluster.clusterExecutiveSellers,
      roleSaleCounts: roleCounts,
      latestSaleDate: dateStr(latestMs),
      lastPx,
    });
  }

  const netScores = percentileScores(drafts.map((d) => d.valueSold));
  const uniqueScores = percentileScores(drafts.map((d) => d.uniqueSellers));
  const execScores = percentileScores(drafts.map((d) => d.executiveSellers));
  const largestScores = percentileScores(drafts.map((d) => d.largestSale));

  const rows: HeavySellingRow[] = drafts.map((d, i) => {
    const clusterScore = clusterSizeToScore(d.clusterSize, d.clusterSelling);
    const heavySellingScore = computeHeavySellingScore({
      netDollarScore: netScores[i] ?? 0,
      uniqueSellersScore: uniqueScores[i] ?? 0,
      executiveScore: execScores[i] ?? 0,
      clusterScore,
      largestSaleScore: largestScores[i] ?? 0,
    });
    const { lastPx: _px, ...rest } = d;
    return {
      ...rest,
      heavySellingScore,
      classification: heavySellingClassification(heavySellingScore),
    };
  });

  rows.sort(
    (a, b) =>
      b.heavySellingScore - a.heavySellingScore ||
      b.valueSold - a.valueSold ||
      a.ticker.localeCompare(b.ticker)
  );

  const sectors = [
    ...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s))),
  ].sort((a, b) => a.localeCompare(b));

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    clusterWindowDays,
    rows,
    sectors,
  };
}
