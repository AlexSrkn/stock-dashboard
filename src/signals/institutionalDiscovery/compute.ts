import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import {
  buildPortfolioSnapshots,
  indexPortfolioSnapshots,
} from "../../institution/performance/portfolioWeights.js";
import { sortQuarters } from "../../institution/performance/quarters.js";
import { formatSecCik } from "../../sec/http.js";
import {
  getTrackedInstitutionByCik,
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "../../ownership/trackedInstitutions.js";
import {
  SELECT_SHARES_OUTSTANDING_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
} from "../hiddenGems/queries.js";
import {
  buildDiscoveryExplanation,
  classifyDiscovery,
  computeDiscoveryScore,
  growthStreakAt,
  holderGrowthPercent,
  longestGrowthStreak,
  percentileScores,
  round1,
  round2,
  round4,
} from "./score.js";
import type {
  DiscoveryHistoryPoint,
  DiscoveryInstitution,
  InstitutionalDiscoveryCachePayload,
  InstitutionalDiscoveryRow,
  InstitutionalDiscoverySummary,
} from "./types.js";

const MAX_INSTITUTION_LIST = 40;

interface HoldingState {
  shares: number;
  valueUsd: number;
}

/** ticker → quarter → cik → holding */
type StockQuarterHolders = Map<string, Map<string, Map<string, HoldingState>>>;

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

function institutionName(cik: string): string {
  return getTrackedInstitutionByCik(cik)?.name ?? cik;
}

function ownershipPct(shares: number, so: number | undefined): number {
  if (!so || so <= 0 || !Number.isFinite(shares) || shares <= 0) return 0;
  return round2((shares / so) * 100);
}

function buildStockQuarterIndex(
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>
): StockQuarterHolders {
  const out: StockQuarterHolders = new Map();
  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares) || h.shares <= 0) continue;
    const ticker = String(h.ticker).trim().toUpperCase();
    const cik = formatSecCik(h.institutionId);
    let byQ = out.get(ticker);
    if (!byQ) {
      byQ = new Map();
      out.set(ticker, byQ);
    }
    let byInst = byQ.get(h.quarter);
    if (!byInst) {
      byInst = new Map();
      byQ.set(h.quarter, byInst);
    }
    const prev = byInst.get(cik) ?? { shares: 0, valueUsd: 0 };
    prev.shares += h.shares;
    prev.valueUsd += Number(h.marketValue) || 0;
    byInst.set(cik, prev);
  }
  return out;
}

function firstRecordedQuarter(
  byQ: Map<string, Map<string, HoldingState>>,
  cik: string,
  quarters: string[]
): string | null {
  for (const q of quarters) {
    const shares = byQ.get(q)?.get(cik)?.shares ?? 0;
    if (shares > 0) return q;
  }
  return null;
}

function toInstitution(
  cik: string,
  state: HoldingState | undefined,
  quarter: string,
  firstQ: string | null,
  weight: number | null
): DiscoveryInstitution {
  return {
    cik,
    name: institutionName(cik),
    shares: round2(state?.shares ?? 0),
    valueUsd: round2(state?.valueUsd ?? 0),
    portfolioWeight: weight != null && Number.isFinite(weight) ? round4(weight) : null,
    firstRecordedQuarter: firstQ,
    latestQuarter: quarter,
  };
}

function sortInstitutions(list: DiscoveryInstitution[]): DiscoveryInstitution[] {
  return [...list]
    .sort((a, b) => b.valueUsd - a.valueUsd || a.name.localeCompare(b.name))
    .slice(0, MAX_INSTITUTION_LIST);
}

interface DraftRow {
  ticker: string;
  quarter: string;
  previousQuarter: string | null;
  currentHolderCount: number;
  previousHolderCount: number;
  netHolderChange: number;
  holderGrowthPercent: number | null;
  newHolderCount: number;
  exitedHolderCount: number;
  firstTimePositionCount: number;
  institutionalOwnershipPercent: number;
  previousInstitutionalOwnershipPercent: number;
  ownershipChangePercent: number;
  currentGrowthStreak: number;
  longestGrowthStreak: number;
  insufficientData: boolean;
  currentShares: number;
  currentValueUsd: number;
  newInstitutions: DiscoveryInstitution[];
  exitedInstitutions: DiscoveryInstitution[];
  firstRecordedPositions: DiscoveryInstitution[];
  historySeed: DiscoveryHistoryPoint;
}

function computeDraftForQuarter(input: {
  ticker: string;
  byQ: Map<string, Map<string, HoldingState>>;
  quarters: string[];
  quarterIdx: number;
  sharesOutstanding: Map<string, number>;
  weightIndex: ReturnType<typeof indexPortfolioSnapshots>;
}): DraftRow | null {
  const { ticker, byQ, quarters, quarterIdx, sharesOutstanding, weightIndex } = input;
  const quarter = quarters[quarterIdx]!;
  const previousQuarter = quarterIdx > 0 ? quarters[quarterIdx - 1]! : null;
  const currentMap = byQ.get(quarter) ?? new Map();
  const previousMap = previousQuarter ? byQ.get(previousQuarter) ?? new Map() : new Map();

  const currentHolders = [...currentMap.keys()].filter((cik) => (currentMap.get(cik)?.shares ?? 0) > 0);
  const previousHolders = [...previousMap.keys()].filter(
    (cik) => (previousMap.get(cik)?.shares ?? 0) > 0
  );
  const currentSet = new Set(currentHolders);
  const previousSet = new Set(previousHolders);

  const newCiks = currentHolders.filter((cik) => !previousSet.has(cik));
  const exitedCiks = previousHolders.filter((cik) => !currentSet.has(cik));

  const firstTimeCiks = newCiks.filter((cik) => {
    const first = firstRecordedQuarter(byQ, cik, quarters);
    return first === quarter;
  });

  let currentShares = 0;
  let currentValueUsd = 0;
  for (const cik of currentHolders) {
    const st = currentMap.get(cik)!;
    currentShares += st.shares;
    currentValueUsd += st.valueUsd;
  }
  let previousShares = 0;
  for (const cik of previousHolders) {
    previousShares += previousMap.get(cik)?.shares ?? 0;
  }

  const so = sharesOutstanding.get(ticker);
  const ownPct = ownershipPct(currentShares, so);
  const prevOwnPct = ownershipPct(previousShares, so);
  const ownershipChangePercent = round2(ownPct - prevOwnPct);

  const countsSeries = quarters.map((q) => {
    const m = byQ.get(q);
    if (!m) return 0;
    let n = 0;
    for (const st of m.values()) if (st.shares > 0) n += 1;
    return n;
  });
  // Longest/current streak only use history through current quarter
  const countsThrough = countsSeries.slice(0, quarterIdx + 1);
  const currentGrowthStreak = growthStreakAt(countsThrough, countsThrough.length - 1);
  const longest = longestGrowthStreak(countsThrough);

  const insufficientData = quarterIdx < 1;

  const newInstitutions = sortInstitutions(
    newCiks.map((cik) => {
      const w = weightIndex.get(cik)?.get(quarter)?.weights?.[ticker] ?? null;
      return toInstitution(cik, currentMap.get(cik), quarter, firstRecordedQuarter(byQ, cik, quarters), w);
    })
  );
  const exitedInstitutions = sortInstitutions(
    exitedCiks.map((cik) => {
      const w = weightIndex.get(cik)?.get(previousQuarter!)?.weights?.[ticker] ?? null;
      return toInstitution(
        cik,
        previousMap.get(cik),
        previousQuarter!,
        firstRecordedQuarter(byQ, cik, quarters),
        w
      );
    })
  );
  const firstRecordedPositions = sortInstitutions(
    firstTimeCiks.map((cik) => {
      const w = weightIndex.get(cik)?.get(quarter)?.weights?.[ticker] ?? null;
      return toInstitution(cik, currentMap.get(cik), quarter, quarter, w);
    })
  );

  const curCount = currentHolders.length;
  const prevCount = previousHolders.length;
  const growth = holderGrowthPercent(curCount, prevCount);

  return {
    ticker,
    quarter,
    previousQuarter,
    currentHolderCount: curCount,
    previousHolderCount: prevCount,
    netHolderChange: curCount - prevCount,
    holderGrowthPercent: growth,
    newHolderCount: newCiks.length,
    exitedHolderCount: exitedCiks.length,
    firstTimePositionCount: firstTimeCiks.length,
    institutionalOwnershipPercent: ownPct,
    previousInstitutionalOwnershipPercent: prevOwnPct,
    ownershipChangePercent,
    currentGrowthStreak,
    longestGrowthStreak: longest,
    insufficientData,
    currentShares,
    currentValueUsd,
    newInstitutions,
    exitedInstitutions,
    firstRecordedPositions,
    historySeed: {
      quarter,
      holderCount: curCount,
      newHolderCount: newCiks.length,
      exitedHolderCount: exitedCiks.length,
      firstTimePositionCount: firstTimeCiks.length,
      institutionalOwnershipPercent: ownPct,
      netHolderChange: previousQuarter == null ? null : curCount - prevCount,
      holderGrowthPercent: growth,
      discoveryScore: null,
      classification: "Insufficient Data",
    },
  };
}

function scoreDrafts(
  drafts: DraftRow[],
  enrichment: Map<string, { companyName: string | null; sector: string | null }>,
  sharesOutstanding: Map<string, number>
): InstitutionalDiscoveryRow[] {
  const eligible = drafts.filter((d) => !d.insufficientData);
  const holderGrowthPct = percentileScores(
    eligible.map((d) => d.holderGrowthPercent ?? Number.NEGATIVE_INFINITY)
  );
  const newHolderPct = percentileScores(eligible.map((d) => d.newHolderCount));
  const streakPct = percentileScores(eligible.map((d) => d.currentGrowthStreak));
  const ownGrowthPct = percentileScores(eligible.map((d) => d.ownershipChangePercent));

  const scoreByKey = new Map<
    string,
    { score: number; components: NonNullable<InstitutionalDiscoveryRow["scoreComponents"]> }
  >();
  eligible.forEach((d, i) => {
    const result = computeDiscoveryScore({
      holderGrowthScore: holderGrowthPct[i] ?? 0,
      newHolderScore: newHolderPct[i] ?? 0,
      growthStreakScore: streakPct[i] ?? 0,
      ownershipGrowthScore: ownGrowthPct[i] ?? 0,
    });
    scoreByKey.set(`${d.ticker}::${d.quarter}`, result);
  });

  return drafts.map((d) => {
    const meta = enrichment.get(d.ticker);
    const so = sharesOutstanding.get(d.ticker);
    const impliedPx =
      d.currentShares > 0 && d.currentValueUsd > 0 ? d.currentValueUsd / d.currentShares : null;
    const marketCapUsd =
      so && so > 0 && impliedPx != null && impliedPx > 0 ? round2(so * impliedPx) : null;

    const scored = scoreByKey.get(`${d.ticker}::${d.quarter}`);
    const discoveryScore = d.insufficientData ? null : scored?.score ?? null;
    const classification = classifyDiscovery(discoveryScore, d.insufficientData);
    const explanation = d.insufficientData
      ? "Insufficient 13F history (need at least 2 quarters)."
      : buildDiscoveryExplanation({
          holderGrowthPercent: d.holderGrowthPercent,
          newHolderCount: d.newHolderCount,
          growthStreak: d.currentGrowthStreak,
          ownershipChangePercent: d.ownershipChangePercent,
        });

    return {
      ticker: d.ticker,
      companyName: meta?.companyName ?? null,
      sector: meta?.sector ?? null,
      marketCapUsd,
      quarter: d.quarter,
      previousQuarter: d.previousQuarter,
      currentHolderCount: d.currentHolderCount,
      previousHolderCount: d.previousHolderCount,
      netHolderChange: d.netHolderChange,
      holderGrowthPercent: d.holderGrowthPercent,
      newHolderCount: d.newHolderCount,
      exitedHolderCount: d.exitedHolderCount,
      firstTimePositionCount: d.firstTimePositionCount,
      institutionalOwnershipPercent: d.institutionalOwnershipPercent,
      previousInstitutionalOwnershipPercent: d.previousInstitutionalOwnershipPercent,
      ownershipChangePercent: d.ownershipChangePercent,
      currentGrowthStreak: d.currentGrowthStreak,
      longestGrowthStreak: d.longestGrowthStreak,
      discoveryScore,
      classification,
      insufficientData: d.insufficientData,
      scoreComponents: d.insufficientData ? null : scored?.components ?? null,
      explanation,
      newInstitutions: d.newInstitutions,
      exitedInstitutions: d.exitedInstitutions,
      firstRecordedPositions: d.firstRecordedPositions,
      history: [
        {
          ...d.historySeed,
          discoveryScore,
          classification,
        },
      ],
    };
  });
}

function attachHistory(rows: InstitutionalDiscoveryRow[]): InstitutionalDiscoveryRow[] {
  const byTicker = new Map<string, DiscoveryHistoryPoint[]>();
  const sorted = [...rows].sort(
    (a, b) => a.quarter.localeCompare(b.quarter) || a.ticker.localeCompare(b.ticker)
  );
  for (const row of sorted) {
    const list = byTicker.get(row.ticker) ?? [];
    list.push({
      quarter: row.quarter,
      holderCount: row.currentHolderCount,
      newHolderCount: row.newHolderCount,
      exitedHolderCount: row.exitedHolderCount,
      firstTimePositionCount: row.firstTimePositionCount,
      institutionalOwnershipPercent: row.institutionalOwnershipPercent,
      netHolderChange: row.previousQuarter == null ? null : row.netHolderChange,
      holderGrowthPercent: row.holderGrowthPercent,
      discoveryScore: row.discoveryScore,
      classification: row.classification,
    });
    byTicker.set(row.ticker, list);
  }
  return rows.map((row) => ({
    ...row,
    history: byTicker.get(row.ticker) ?? row.history,
  }));
}

function buildSummary(
  rows: InstitutionalDiscoveryRow[],
  currentQuarter: string,
  previousQuarter: string | null
): InstitutionalDiscoverySummary {
  const scored = rows.filter((r) => !r.insufficientData && r.discoveryScore != null);
  let fastest: InstitutionalDiscoverySummary["fastestHolderGrowth"] = null;
  let longest: InstitutionalDiscoverySummary["longestAdoptionStreak"] = null;
  let newPositions = 0;
  let discoveries = 0;

  for (const row of scored) {
    newPositions += row.newHolderCount;
    if ((row.discoveryScore ?? 0) >= 60) discoveries += 1;
    if (
      row.holderGrowthPercent != null &&
      (!fastest || row.holderGrowthPercent > fastest.holderGrowthPercent)
    ) {
      fastest = {
        ticker: row.ticker,
        companyName: row.companyName,
        holderGrowthPercent: row.holderGrowthPercent,
      };
    }
    if (!longest || row.currentGrowthStreak > longest.streak) {
      longest = {
        ticker: row.ticker,
        companyName: row.companyName,
        streak: row.currentGrowthStreak,
      };
    }
  }

  return {
    newDiscoveries: discoveries,
    newInstitutionalPositions: newPositions,
    fastestHolderGrowth: fastest,
    longestAdoptionStreak: longest,
    currentQuarter,
    previousQuarter,
  };
}

/** Heavy compute from tracked 13F holdings — prefer warm cache. */
export async function computeInstitutionalDiscovery(
  pool: pg.Pool = getPool()
): Promise<InstitutionalDiscoveryCachePayload> {
  void TRACKED_INSTITUTIONAL_MANAGERS; // ensure seed linked for name resolution

  const [holdings, sharesOutstanding] = await Promise.all([
    loadInstitutionHoldings(pool, undefined, { maxQuarters: 8 }),
    loadSharesOutstanding(pool),
  ]);

  const quarters = sortQuarters([...new Set(holdings.map((h) => h.quarter).filter(Boolean))]);
  const currentQuarter = quarters[quarters.length - 1] ?? "";
  const previousQuarter = quarters.length >= 2 ? quarters[quarters.length - 2]! : null;

  const weightIndex = indexPortfolioSnapshots(buildPortfolioSnapshots(holdings));
  const stockIndex = buildStockQuarterIndex(holdings);

  const tickers = [...stockIndex.keys()].sort((a, b) => a.localeCompare(b));
  const enrichment = await loadStockEnrichment(pool, tickers);

  const drafts: DraftRow[] = [];
  for (const ticker of tickers) {
    const byQ = stockIndex.get(ticker)!;
    for (let i = 0; i < quarters.length; i++) {
      // Skip quarters with no activity and no prior holders (empty noise)
      const q = quarters[i]!;
      const hasCur = (byQ.get(q)?.size ?? 0) > 0;
      const hasPrev = i > 0 && (byQ.get(quarters[i - 1]!)?.size ?? 0) > 0;
      if (!hasCur && !hasPrev) continue;
      const draft = computeDraftForQuarter({
        ticker,
        byQ,
        quarters,
        quarterIdx: i,
        sharesOutstanding,
        weightIndex,
      });
      if (draft) drafts.push(draft);
    }
  }

  const scored = scoreDrafts(drafts, enrichment, sharesOutstanding);
  const withHistory = attachHistory(scored);

  withHistory.sort(
    (a, b) =>
      (b.discoveryScore ?? -1) - (a.discoveryScore ?? -1) ||
      (b.holderGrowthPercent ?? -1) - (a.holderGrowthPercent ?? -1) ||
      a.ticker.localeCompare(b.ticker)
  );

  const latest = currentQuarter
    ? withHistory.filter((r) => r.quarter === currentQuarter && !r.insufficientData)
    : [];

  // Cache only the latest pair of quarters (UI default + QoQ). Keeping every
  // ticker×quarter row blew past ~500MB / 1.5GB heap on the production VPS.
  const keepQuarters = new Set(
    [currentQuarter, previousQuarter].filter((q): q is string => Boolean(q))
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

  const pairQuarters = sortQuarters([...keepQuarters]);

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    currentQuarter,
    previousQuarter,
    quarters: pairQuarters.length ? pairQuarters : currentQuarter ? [currentQuarter] : [],
    summary: buildSummary(latest, currentQuarter, previousQuarter),
    sectors,
    signals: slimSignals,
  };
}
