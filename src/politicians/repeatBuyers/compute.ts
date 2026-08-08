import { getPool } from "../../db/pool.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "../../institution/mostAccumulated/queries.js";
import {
  amountMid,
  parseTradeDateMs,
  politicianKey,
  resolveTicker,
  tradeDate,
} from "../analytics/compute.js";
import { readPoliticiansRecent, type PoliticianFilingBundle } from "../recent.js";
import {
  computePoliticianRepeatBuyerScore,
  currentPurchaseStreak,
  percentileScores,
  politicianRepeatBuyerClassification,
  round2,
  toIsoDate,
} from "./score.js";
import type {
  PoliticianRepeatBuyerRow,
  PoliticianRepeatBuyersCachePayload,
} from "./types.js";

const MS_DAY = 86_400_000;
const MS_3M = 90 * MS_DAY;
const MS_6M = 180 * MS_DAY;
const MS_12M = 365 * MS_DAY;
const MS_24M = 730 * MS_DAY;
const MIN_PURCHASES = 2;

interface FlatTrade {
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  state: string | null;
  party: string | null;
  ticker: string;
  assetName: string | null;
  category: "buy" | "sell";
  dateMs: number;
  dateIso: string | null;
  amountMin: number;
  amountMax: number;
  amountMid: number;
}

interface GroupAgg {
  ticker: string;
  assetName: string | null;
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  state: string | null;
  party: string | null;
  buys: FlatTrade[];
  codes: Array<"buy" | "sell">;
}

async function loadStockEnrichment(
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  if (!tickers.length) return out;
  try {
    const pool = getPool();
    const res = await pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
    }>(SELECT_STOCK_ENRICHMENT_SQL, [tickers]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        companyName: row.company_name ? String(row.company_name) : null,
        sector: row.sector ? String(row.sector) : null,
      });
    }
  } catch {
    /* enrichment optional when database unavailable */
  }
  return out;
}

function isValidTicker(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(ticker);
}

function flattenAllTrades(bundles: PoliticianFilingBundle[]): FlatTrade[] {
  const rows: FlatTrade[] = [];
  for (const bundle of bundles) {
    const key = bundle.politicianKey || politicianKey(bundle.politicianName);
    const party = bundle.party ?? null;
    for (const trade of bundle.trades || []) {
      const ticker = resolveTicker(trade);
      if (!ticker || !isValidTicker(ticker)) continue;
      const category =
        trade.transactionCategory === "buy"
          ? "buy"
          : trade.transactionCategory === "sell"
            ? "sell"
            : null;
      if (!category) continue;
      const when = parseTradeDateMs(tradeDate(trade));
      const mid = amountMid(trade);
      const min = Number(trade.amountMin);
      const max = Number(trade.amountMax);
      rows.push({
        politicianKey: key,
        politicianName: bundle.politicianName,
        chamber: bundle.chamber,
        state: trade.state
          ? String(trade.state).toUpperCase()
          : bundle.state
            ? String(bundle.state).toUpperCase()
            : null,
        party: trade.party ?? party,
        ticker,
        assetName: trade.assetName ? String(trade.assetName).trim() || null : null,
        category,
        dateMs: when || 0,
        dateIso: when ? toIsoDate(when) : null,
        amountMin: Number.isFinite(min) && min > 0 ? min : 0,
        amountMax: Number.isFinite(max) && max > 0 ? max : 0,
        amountMid: mid > 0 ? mid : 0,
      });
    }
  }
  return rows;
}

function groupKey(row: Pick<FlatTrade, "ticker" | "politicianKey">): string {
  return `${row.ticker}::${row.politicianKey}`;
}

function buildGroups(trades: FlatTrade[]): GroupAgg[] {
  const map = new Map<string, GroupAgg>();
  const sorted = [...trades].sort((a, b) => {
    if (a.dateMs !== b.dateMs) return a.dateMs - b.dateMs;
    return a.politicianKey.localeCompare(b.politicianKey) || a.ticker.localeCompare(b.ticker);
  });

  for (const row of sorted) {
    const key = groupKey(row);
    let g = map.get(key);
    if (!g) {
      g = {
        ticker: row.ticker,
        assetName: row.assetName,
        politicianKey: row.politicianKey,
        politicianName: row.politicianName,
        chamber: row.chamber,
        state: row.state,
        party: row.party,
        buys: [],
        codes: [],
      };
      map.set(key, g);
    }
    if (row.assetName && !g.assetName) g.assetName = row.assetName;
    if (row.state && !g.state) g.state = row.state;
    if (row.party && !g.party) g.party = row.party;

    if (row.category === "buy") {
      g.buys.push(row);
      g.codes.push("buy");
    } else {
      g.codes.push("sell");
    }
  }

  return [...map.values()].filter((g) => g.buys.length >= MIN_PURCHASES);
}

export async function computePoliticianRepeatBuyers(): Promise<PoliticianRepeatBuyersCachePayload> {
  const payload = readPoliticiansRecent();
  if (!payload) {
    return {
      version: 1,
      computedAt: new Date().toISOString(),
      fetchedAt: null,
      rows: [],
      sectors: [],
      politicians: [],
      states: [],
      parties: [],
    };
  }

  const flat = flattenAllTrades([...payload.house, ...payload.senate]);
  const groups = buildGroups(flat);
  const tickers = [...new Set(groups.map((g) => g.ticker))];
  const enrichment = await loadStockEnrichment(tickers);
  const now = Date.now();

  const drafts = groups.map((g) => {
    const buyTimes = g.buys.map((b) => b.dateMs).filter((t) => t > 0);
    const firstMs = buyTimes.length ? Math.min(...buyTimes) : Number.NaN;
    const latestMs = buyTimes.length ? Math.max(...buyTimes) : Number.NaN;

    let purchasesLast3Months = 0;
    let purchasesLast6Months = 0;
    let purchasesLast12Months = 0;
    let purchasesLast24Months = 0;
    let totalMin = 0;
    let totalMax = 0;
    let estimated = 0;

    for (const b of g.buys) {
      totalMin += b.amountMin;
      totalMax += b.amountMax > 0 ? b.amountMax : b.amountMin;
      estimated += b.amountMid > 0 ? b.amountMid : (b.amountMin + (b.amountMax || b.amountMin)) / 2;
      const t = b.dateMs;
      if (t >= now - MS_3M) purchasesLast3Months += 1;
      if (t >= now - MS_6M) purchasesLast6Months += 1;
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

    const purchaseCount = g.buys.length;
    const purchaseStreak = currentPurchaseStreak(g.codes);
    const estimatedTotalInvested = round2(estimated);
    const averagePurchaseSize =
      purchaseCount > 0 ? round2(estimatedTotalInvested / purchaseCount) : 0;
    const stock = enrichment.get(g.ticker);

    return {
      ticker: g.ticker,
      companyName: stock?.companyName || g.assetName,
      sector: stock?.sector || null,
      marketCapUsd: null as number | null,
      politicianKey: g.politicianKey,
      politicianName: g.politicianName,
      party: g.party,
      state: g.state,
      chamber: g.chamber,
      purchaseCount,
      purchasesLast3Months,
      purchasesLast6Months,
      purchasesLast12Months,
      purchasesLast24Months,
      purchaseStreak,
      totalMinInvested: round2(totalMin),
      totalMaxInvested: round2(totalMax),
      estimatedTotalInvested,
      averagePurchaseSize,
      averageDaysBetweenPurchases,
      firstPurchase: toIsoDate(firstMs),
      latestPurchase: toIsoDate(latestMs),
      avgDaysForScore: averageDaysBetweenPurchases,
      recentForScore: purchasesLast3Months,
    };
  });

  const countScores = percentileScores(drafts.map((d) => d.purchaseCount));
  const streakScores = percentileScores(drafts.map((d) => d.purchaseStreak));
  const investScores = percentileScores(drafts.map((d) => d.estimatedTotalInvested));
  const avgDaysRaw = drafts.map((d) =>
    d.avgDaysForScore != null && d.avgDaysForScore > 0 ? d.avgDaysForScore : Number.POSITIVE_INFINITY
  );
  const avgDaysPct = percentileScores(
    avgDaysRaw.map((v) => (Number.isFinite(v) ? v : 1e12))
  );
  const frequencyScores = avgDaysPct.map((p) => 100 - p);
  const recencyScores = percentileScores(drafts.map((d) => d.recentForScore));

  const rows: PoliticianRepeatBuyerRow[] = drafts.map((d, i) => {
    const purchaseCountScore = countScores[i] ?? 0;
    const streakScore = streakScores[i] ?? 0;
    const investmentScore = investScores[i] ?? 0;
    const frequencyScore = frequencyScores[i] ?? 0;
    const recencyScore = recencyScores[i] ?? 0;
    const repeatBuyerScore = computePoliticianRepeatBuyerScore({
      purchaseCountScore,
      streakScore,
      investmentScore,
      frequencyScore,
      recencyScore,
    });

    return {
      ticker: d.ticker,
      companyName: d.companyName,
      sector: d.sector,
      marketCapUsd: d.marketCapUsd,
      politicianKey: d.politicianKey,
      politicianName: d.politicianName,
      party: d.party,
      state: d.state,
      chamber: d.chamber,
      purchaseCount: d.purchaseCount,
      purchasesLast3Months: d.purchasesLast3Months,
      purchasesLast6Months: d.purchasesLast6Months,
      purchasesLast12Months: d.purchasesLast12Months,
      purchasesLast24Months: d.purchasesLast24Months,
      purchaseStreak: d.purchaseStreak,
      totalMinInvested: d.totalMinInvested,
      totalMaxInvested: d.totalMaxInvested,
      estimatedTotalInvested: d.estimatedTotalInvested,
      averagePurchaseSize: d.averagePurchaseSize,
      averageDaysBetweenPurchases: d.averageDaysBetweenPurchases,
      firstPurchase: d.firstPurchase,
      latestPurchase: d.latestPurchase,
      repeatBuyerScore,
      classification: politicianRepeatBuyerClassification(repeatBuyerScore),
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
  ].sort();
  const politicianMap = new Map<string, string>();
  const states = new Set<string>();
  const parties = new Set<string>();
  for (const row of rows) {
    politicianMap.set(row.politicianKey, row.politicianName);
    if (row.state) states.add(row.state);
    if (row.party) parties.add(row.party);
  }

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    fetchedAt: payload.fetchedAt,
    rows,
    sectors,
    politicians: [...politicianMap.entries()]
      .map(([politicianKey, politicianName]) => ({ politicianKey, politicianName }))
      .sort((a, b) => a.politicianName.localeCompare(b.politicianName)),
    states: [...states].sort(),
    parties: [...parties].sort(),
  };
}
