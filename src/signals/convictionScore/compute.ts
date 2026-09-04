import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import { previousQuarter, sortQuarters } from "../../institution/performance/quarters.js";
import { SELECT_INSTITUTION_QUARTERS_BATCH_SQL } from "../../institution/performance/queries.js";
import { formatSecCik } from "../../sec/http.js";
import {
  TRACKED_INSTITUTIONAL_CIK_PADDED,
  reloadTrackedInstitutions,
} from "../../ownership/trackedInstitutions.js";
import {
  SELECT_SHARES_OUTSTANDING_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
} from "../hiddenGems/queries.js";
import {
  accumulationComponentScore,
  buildExplanation,
  classifyConviction,
  computeInstitutionalConvictionScore,
  highConvictionBreadthMetric,
  median,
  percentileScores,
  persistenceComponentScore,
  round1,
  round2,
  round4,
} from "./score.js";
import type {
  ConvictionHistoryPoint,
  ConvictionScoreCachePayload,
  ConvictionScoreRow,
  ConvictionScoreSummary,
  ConvictionScoreThresholds,
} from "./types.js";
import { DEFAULT_CONVICTION_THRESHOLDS } from "./types.js";

/** CIKs per holdings query — keep small on 4GB VPS. */
const HOLDINGS_CIK_BATCH = 60;
/** Quarters loaded for streak math (4Q accumulation needs ~4). */
const MAX_HOLDINGS_QUARTERS = 4;

interface InstTickerQuarter {
  shares: number;
  valueUsd: number;
  /** Position weight in that institution's portfolio for the quarter (0–1). */
  portfolioWeight: number;
}

/** institutionId::ticker → quarter → state */
type HistoryMap = Map<string, Map<string, InstTickerQuarter>>;

function mergeHoldingsIntoHistory(
  map: HistoryMap,
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>
): void {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    if (!h.ticker || !Number.isFinite(h.marketValue) || h.marketValue <= 0) continue;
    const cik = formatSecCik(h.institutionId);
    const tk = `${cik}::${h.quarter}`;
    totals.set(tk, (totals.get(tk) ?? 0) + Number(h.marketValue));
  }

  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares)) continue;
    const cik = formatSecCik(h.institutionId);
    const key = `${cik}::${h.ticker}`;
    let byQ = map.get(key);
    if (!byQ) {
      byQ = new Map();
      map.set(key, byQ);
    }
    const totalKey = `${cik}::${h.quarter}`;
    const total = totals.get(totalKey) ?? 0;
    const mv = Number(h.marketValue) || 0;
    const w = total > 0 && mv > 0 ? mv / total : 0;
    const prev = byQ.get(h.quarter) ?? { shares: 0, valueUsd: 0, portfolioWeight: 0 };
    prev.shares += h.shares;
    prev.valueUsd += mv;
    // Recompute weight from accumulated value after share merges in the same batch.
    prev.portfolioWeight = total > 0 ? prev.valueUsd / total : 0;
    if (w > 0 && prev.portfolioWeight <= 0) prev.portfolioWeight = w;
    byQ.set(h.quarter, prev);
  }
}

async function loadSharesOutstanding(pool: pg.Pool): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await pool.query<{ ticker: string; shares_outstanding: number | null }>(
      SELECT_SHARES_OUTSTANDING_SQL
    );
    for (const row of res.rows) {
      const so = Number(row.shares_outstanding);
      if (Number.isFinite(so) && so > 0) out.set(String(row.ticker).toUpperCase(), so);
    }
  } catch {
    /* optional */
  }
  return out;
}

async function loadStockEnrichment(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  if (!tickers.length) return new Map();
  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string | null;
  }>(SELECT_STOCK_ENRICHMENT_SQL, [tickers]);
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  for (const row of res.rows) {
    out.set(String(row.ticker).toUpperCase(), {
      companyName: row.company_name ? String(row.company_name) : null,
      sector: row.sector ? String(row.sector) : null,
    });
  }
  return out;
}

function sharesAt(byQ: Map<string, InstTickerQuarter> | undefined, quarter: string): number {
  if (!byQ) return 0;
  return byQ.get(quarter)?.shares ?? 0;
}

/**
 * Consecutive quarters ending at `quarter` where position was increased or maintained
 * (shares >= prior quarter shares), requiring a positive position in the ending quarter.
 */
function accumulationStreakAt(
  byQ: Map<string, InstTickerQuarter>,
  quarter: string,
  quartersChronological: string[]
): number {
  const idx = quartersChronological.indexOf(quarter);
  if (idx < 0) return 0;
  const curShares = sharesAt(byQ, quarter);
  if (curShares <= 0) return 0;

  let streak = 0;
  for (let i = idx; i >= 0; i--) {
    const q = quartersChronological[i]!;
    const shares = sharesAt(byQ, q);
    if (shares <= 0) break;
    if (i === 0) {
      streak += 1;
      break;
    }
    const prevShares = sharesAt(byQ, quartersChronological[i - 1]!);
    if (prevShares <= 0) {
      // New position counts as start of streak
      streak += 1;
      break;
    }
    if (shares + 1e-9 >= prevShares) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

interface DraftMetrics {
  ticker: string;
  quarter: string;
  previousQuarter: string | null;
  institutionalHolders: number;
  weights: number[];
  medianPortfolioWeight: number;
  averagePortfolioWeight: number;
  holdersAbove1Percent: number;
  holdersAbove2Percent: number;
  holdersAbove5Percent: number;
  holdersAbove10Percent: number;
  convictionBreadth: number;
  percentageAbove2Percent: number;
  percentageAbove5Percent: number;
  institutionsIncreasing: number;
  institutionsDecreasing: number;
  institutionsMaintaining: number;
  newPositions: number;
  exitedPositions: number;
  accumulationRatio: number;
  averageAccumulationStreak: number;
  maxAccumulationStreak: number;
  institutionsAccumulating2PlusQuarters: number;
  institutionsAccumulating3PlusQuarters: number;
  institutionsAccumulating4PlusQuarters: number;
  currentValueUsd: number;
  currentShares: number;
  breadthMetric: number;
  accumulationScoreRaw: number;
  persistenceScoreRaw: number;
}

function computeQuarterDrafts(input: {
  history: HistoryMap;
  quarters: string[];
  quarter: string;
  thresholds: ConvictionScoreThresholds;
}): DraftMetrics[] {
  const { history, quarters, quarter, thresholds } = input;
  const prevQ = previousQuarter(quarter);
  const qIdx = quarters.indexOf(quarter);
  const quartersUpTo = qIdx >= 0 ? quarters.slice(0, qIdx + 1) : quarters;

  type Agg = {
    holders: Set<string>;
    weights: number[];
    increasing: number;
    decreasing: number;
    maintaining: number;
    newPositions: number;
    exited: number;
    existingBase: number;
    streaks: number[];
    currentValueUsd: number;
    currentShares: number;
  };

  const byTicker = new Map<string, Agg>();

  for (const [pairKey, byQ] of history) {
    const [cik, ticker] = pairKey.split("::");
    if (!cik || !ticker) continue;

    const cur = sharesAt(byQ, quarter);
    const prev = prevQ ? sharesAt(byQ, prevQ) : 0;
    if (cur <= 0 && prev <= 0) continue;

    let agg = byTicker.get(ticker);
    if (!agg) {
      agg = {
        holders: new Set(),
        weights: [],
        increasing: 0,
        decreasing: 0,
        maintaining: 0,
        newPositions: 0,
        exited: 0,
        existingBase: 0,
        streaks: [],
        currentValueUsd: 0,
        currentShares: 0,
      };
      byTicker.set(ticker, agg);
    }

    if (cur > 0) {
      agg.holders.add(cik);
      agg.currentShares += cur;
      agg.currentValueUsd += byQ.get(quarter)?.valueUsd ?? 0;

      const w = byQ.get(quarter)?.portfolioWeight;
      if (typeof w === "number" && Number.isFinite(w) && w > 0) {
        agg.weights.push(w);
      }

      const streak = accumulationStreakAt(byQ, quarter, quartersUpTo);
      agg.streaks.push(streak);
    }

    if (prev > 0) agg.existingBase += 1;

    if (prev <= 0 && cur > 0) {
      agg.newPositions += 1;
    } else if (prev > 0 && cur <= 0) {
      agg.exited += 1;
    } else if (prev > 0 && cur > 0) {
      if (cur > prev + 1e-6) agg.increasing += 1;
      else if (cur < prev - 1e-6) agg.decreasing += 1;
      else agg.maintaining += 1;
    }
  }

  const drafts: DraftMetrics[] = [];

  for (const [ticker, agg] of byTicker) {
    const holders = agg.holders.size;
    if (holders <= 0 && agg.exited <= 0) continue;

    const weights = agg.weights;
    const medianW = median(weights);
    const avgW = weights.length ? weights.reduce((s, w) => s + w, 0) / weights.length : 0;

    const above1 = weights.filter((w) => w > thresholds.highConvictionWeight1Pct).length;
    const above2 = weights.filter((w) => w > thresholds.highConvictionWeight2Pct).length;
    const above5 = weights.filter((w) => w > thresholds.highConvictionWeight5Pct).length;
    const above10 = weights.filter((w) => w > thresholds.highConvictionWeight10Pct).length;

    const convictionBreadth = holders > 0 ? above1 / holders : 0;
    const pctAbove2 = holders > 0 ? above2 / holders : 0;
    const pctAbove5 = holders > 0 ? above5 / holders : 0;

    const accumulationRatio =
      agg.existingBase > 0
        ? Math.min(1, agg.increasing / agg.existingBase)
        : agg.newPositions > 0
          ? 1
          : 0;

    const avgStreak = agg.streaks.length
      ? agg.streaks.reduce((s, v) => s + v, 0) / agg.streaks.length
      : 0;
    const maxStreak = agg.streaks.length ? Math.max(...agg.streaks) : 0;
    const streak2 = agg.streaks.filter((s) => s >= 2).length;
    const streak3 = agg.streaks.filter((s) => s >= 3).length;
    const streak4 = agg.streaks.filter((s) => s >= 4).length;

    // Active = current holders + exits this quarter (institutions that touched the name)
    const activeForAccum = Math.max(1, holders + agg.exited);

    drafts.push({
      ticker,
      quarter,
      previousQuarter: prevQ,
      institutionalHolders: holders,
      weights,
      medianPortfolioWeight: round4(medianW),
      averagePortfolioWeight: round4(avgW),
      holdersAbove1Percent: above1,
      holdersAbove2Percent: above2,
      holdersAbove5Percent: above5,
      holdersAbove10Percent: above10,
      convictionBreadth: round4(convictionBreadth),
      percentageAbove2Percent: round4(pctAbove2),
      percentageAbove5Percent: round4(pctAbove5),
      institutionsIncreasing: agg.increasing,
      institutionsDecreasing: agg.decreasing,
      institutionsMaintaining: agg.maintaining,
      newPositions: agg.newPositions,
      exitedPositions: agg.exited,
      accumulationRatio: round4(accumulationRatio),
      averageAccumulationStreak: round2(avgStreak),
      maxAccumulationStreak: maxStreak,
      institutionsAccumulating2PlusQuarters: streak2,
      institutionsAccumulating3PlusQuarters: streak3,
      institutionsAccumulating4PlusQuarters: streak4,
      currentValueUsd: agg.currentValueUsd,
      currentShares: agg.currentShares,
      breadthMetric: highConvictionBreadthMetric(convictionBreadth * 100, pctAbove2 * 100),
      accumulationScoreRaw: accumulationComponentScore({
        increasing: agg.increasing,
        decreasing: agg.decreasing,
        newPositions: agg.newPositions,
        totalActive: activeForAccum,
      }),
      persistenceScoreRaw: persistenceComponentScore({
        averageStreak: avgStreak,
        holders: Math.max(1, holders),
        streak2Plus: streak2,
        streak3Plus: streak3,
        streak4Plus: streak4,
      }),
    });
  }

  return drafts;
}

function scoreDrafts(
  drafts: DraftMetrics[],
  thresholds: ConvictionScoreThresholds,
  enrichment: Map<string, { companyName: string | null; sector: string | null }>,
  sharesOutstanding: Map<string, number>
): ConvictionScoreRow[] {
  const scored = drafts.filter((d) => d.institutionalHolders >= thresholds.minHolders);
  const weightPct = percentileScores(scored.map((d) => d.medianPortfolioWeight));
  const breadthPct = percentileScores(scored.map((d) => d.breadthMetric));

  const scoreByTicker = new Map<string, { score: number; components: NonNullable<ConvictionScoreRow["scoreComponents"]> }>();
  scored.forEach((d, i) => {
    const result = computeInstitutionalConvictionScore({
      portfolioWeightScore: weightPct[i] ?? 0,
      highConvictionBreadthScore: breadthPct[i] ?? 0,
      accumulationScore: d.accumulationScoreRaw,
      persistenceScore: d.persistenceScoreRaw,
    });
    scoreByTicker.set(d.ticker, result);
  });

  return drafts.map((d) => {
    const meta = enrichment.get(d.ticker);
    const so = sharesOutstanding.get(d.ticker);
    const impliedPx =
      d.currentShares > 0 && d.currentValueUsd > 0
        ? d.currentValueUsd / d.currentShares
        : null;
    const marketCapUsd =
      so && so > 0 && impliedPx != null && impliedPx > 0 ? round2(so * impliedPx) : null;

    const insufficientData = d.institutionalHolders < thresholds.minHolders;
    const scoredHit = scoreByTicker.get(d.ticker);
    const convictionScore = insufficientData ? null : scoredHit?.score ?? null;
    const classification =
      convictionScore == null ? null : classifyConviction(convictionScore);

    return {
      ticker: d.ticker,
      companyName: meta?.companyName ?? null,
      sector: meta?.sector ?? null,
      marketCapUsd,
      convictionScore,
      classification,
      insufficientData,
      institutionalHolders: d.institutionalHolders,
      medianPortfolioWeight: d.medianPortfolioWeight,
      averagePortfolioWeight: d.averagePortfolioWeight,
      holdersAbove1Percent: d.holdersAbove1Percent,
      holdersAbove2Percent: d.holdersAbove2Percent,
      holdersAbove5Percent: d.holdersAbove5Percent,
      holdersAbove10Percent: d.holdersAbove10Percent,
      convictionBreadth: d.convictionBreadth,
      percentageAbove2Percent: d.percentageAbove2Percent,
      percentageAbove5Percent: d.percentageAbove5Percent,
      institutionsIncreasing: d.institutionsIncreasing,
      institutionsDecreasing: d.institutionsDecreasing,
      institutionsMaintaining: d.institutionsMaintaining,
      newPositions: d.newPositions,
      exitedPositions: d.exitedPositions,
      accumulationRatio: d.accumulationRatio,
      averageAccumulationStreak: d.averageAccumulationStreak,
      maxAccumulationStreak: d.maxAccumulationStreak,
      institutionsAccumulating2PlusQuarters: d.institutionsAccumulating2PlusQuarters,
      institutionsAccumulating3PlusQuarters: d.institutionsAccumulating3PlusQuarters,
      institutionsAccumulating4PlusQuarters: d.institutionsAccumulating4PlusQuarters,
      scoreComponents: insufficientData ? null : scoredHit?.components ?? null,
      explanation: buildExplanation({
        holders: d.institutionalHolders,
        medianWeight: d.medianPortfolioWeight,
        increasing: d.institutionsIncreasing,
        holdersAbove2: d.holdersAbove2Percent,
      }),
      quarter: d.quarter,
      previousQuarter: d.previousQuarter,
      history: [],
    };
  });
}

function attachHistory(allRows: ConvictionScoreRow[]): ConvictionScoreRow[] {
  const byTicker = new Map<string, ConvictionHistoryPoint[]>();
  const sorted = [...allRows].sort(
    (a, b) => a.quarter.localeCompare(b.quarter) || a.ticker.localeCompare(b.ticker)
  );
  for (const row of sorted) {
    const list = byTicker.get(row.ticker) ?? [];
    list.push({
      quarter: row.quarter,
      convictionScore: row.convictionScore,
      classification: row.classification,
      medianPortfolioWeight: row.medianPortfolioWeight,
      institutionalHolders: row.institutionalHolders,
      accumulationRatio: row.accumulationRatio,
      insufficientData: row.insufficientData,
    });
    byTicker.set(row.ticker, list);
  }
  return allRows.map((row) => ({
    ...row,
    history: byTicker.get(row.ticker) ?? [],
  }));
}

function buildSummary(
  rows: ConvictionScoreRow[],
  currentQuarter: string,
  previousQuarter: string | null
): ConvictionScoreSummary {
  const scored = rows.filter(
    (r) => !r.insufficientData && r.convictionScore != null && Number.isFinite(r.convictionScore)
  );
  let highest: ConvictionScoreSummary["highestConviction"] = null;
  let sum = 0;
  let high = 0;
  let exceptional = 0;
  for (const row of scored) {
    const score = row.convictionScore!;
    sum += score;
    if (score >= 75) high += 1;
    if (score >= 90) exceptional += 1;
    if (!highest || score > highest.score) {
      highest = {
        ticker: row.ticker,
        companyName: row.companyName,
        score,
      };
    }
  }
  return {
    highestConviction: highest,
    averageConviction: scored.length ? round1(sum / scored.length) : null,
    highConvictionStocks: high,
    exceptionalConvictionStocks: exceptional,
    currentQuarter,
    previousQuarter,
  };
}

/** Heavy compute — prefer warm cache. Uses tracked 13F holdings only. */
export async function computeConvictionScores(
  pool: pg.Pool = getPool(),
  thresholds: ConvictionScoreThresholds = DEFAULT_CONVICTION_THRESHOLDS
): Promise<ConvictionScoreCachePayload> {
  reloadTrackedInstitutions();
  const ciks = [...TRACKED_INSTITUTIONAL_CIK_PADDED].map((c) => formatSecCik(c));

  const [qRes, sharesOutstanding] = await Promise.all([
    pool.query<{ quarter: string }>(SELECT_INSTITUTION_QUARTERS_BATCH_SQL, [ciks]),
    loadSharesOutstanding(pool),
  ]);
  const quarters = sortQuarters(qRes.rows.map((r) => String(r.quarter))).slice(
    -MAX_HOLDINGS_QUARTERS
  );
  const currentQuarter = quarters[quarters.length - 1] ?? "";
  const previousQuarterLabel =
    quarters.length >= 2 ? quarters[quarters.length - 2]! : previousQuarter(currentQuarter);

  if (!quarters.length || !ciks.length) {
    return {
      version: 1,
      computedAt: new Date().toISOString(),
      currentQuarter,
      previousQuarter: previousQuarterLabel,
      quarters: [],
      thresholds,
      summary: buildSummary([], currentQuarter, previousQuarterLabel),
      sectors: [],
      signals: [],
    };
  }

  const history: HistoryMap = new Map();
  const tickerSet = new Set<string>();
  const totalBatches = Math.ceil(ciks.length / HOLDINGS_CIK_BATCH) || 1;

  for (let i = 0; i < ciks.length; i += HOLDINGS_CIK_BATCH) {
    const batch = ciks.slice(i, i + HOLDINGS_CIK_BATCH);
    const batchNo = Math.floor(i / HOLDINGS_CIK_BATCH) + 1;
    process.stdout.write(
      `  holdings [${batchNo}/${totalBatches}] ${batch.length} CIKs… `
    );
    const t0 = Date.now();
    const holdings = await loadInstitutionHoldings(pool, batch, { quarters });
    mergeHoldingsIntoHistory(history, holdings);
    for (const h of holdings) {
      if (h.ticker) tickerSet.add(String(h.ticker).toUpperCase());
    }
    console.log(`ok (${holdings.length} rows, ${Date.now() - t0}ms)`);
  }

  const tickers = [...tickerSet];
  const enrichment = await loadStockEnrichment(pool, tickers);

  const allRows: ConvictionScoreRow[] = [];
  const scoreFromIdx = Math.max(1, quarters.length - 2);
  for (let i = scoreFromIdx; i < quarters.length; i++) {
    const q = quarters[i]!;
    const drafts = computeQuarterDrafts({
      history,
      quarters,
      quarter: q,
      thresholds,
    });
    allRows.push(...scoreDrafts(drafts, thresholds, enrichment, sharesOutstanding));
  }

  const withHistory = attachHistory(allRows);
  withHistory.sort(
    (a, b) =>
      (b.convictionScore ?? -1) - (a.convictionScore ?? -1) ||
      b.institutionalHolders - a.institutionalHolders ||
      a.ticker.localeCompare(b.ticker)
  );

  const latest = currentQuarter
    ? withHistory.filter((r) => r.quarter === currentQuarter && !r.insufficientData)
    : [];

  const keepQuarters = new Set(
    [currentQuarter, previousQuarterLabel].filter((q): q is string => Boolean(q))
  );
  const slimSignals = withHistory
    .filter((r) => keepQuarters.has(r.quarter) && !r.insufficientData)
    .map((r) => ({
      ...r,
      history: r.history.filter((h) => keepQuarters.has(h.quarter)),
    }));

  const sectors = [
    ...new Set(slimSignals.map((s) => s.sector).filter((s): s is string => !!s)),
  ].sort((a, b) => a.localeCompare(b));

  const pairQuarters = [...keepQuarters].sort((a, b) => a.localeCompare(b));

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    currentQuarter,
    previousQuarter: previousQuarterLabel,
    quarters: pairQuarters.length ? pairQuarters : currentQuarter ? [currentQuarter] : [],
    thresholds,
    summary: buildSummary(latest, currentQuarter, previousQuarterLabel),
    sectors,
    signals: slimSignals,
  };
}
