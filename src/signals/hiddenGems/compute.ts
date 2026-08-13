import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import {
  buildPortfolioSnapshots,
  indexPortfolioSnapshots,
} from "../../institution/performance/portfolioWeights.js";
import { sortQuarters } from "../../institution/performance/quarters.js";
import { formatSecCik } from "../../sec/http.js";
import { SELECT_SHARES_OUTSTANDING_SQL, SELECT_STOCK_ENRICHMENT_SQL } from "./queries.js";
import {
  computeConvictionScore,
  computeHiddenGemScore,
  labelForScore,
  median,
  qualifiesAsHiddenGem,
  round1,
  round2,
  round4,
} from "./score.js";
import type {
  HiddenGemRow,
  HiddenGemSummary,
  HiddenGemThresholds,
  HiddenGemsCachePayload,
} from "./types.js";
import { DEFAULT_HIDDEN_GEM_THRESHOLDS } from "./types.js";

interface InstTickerState {
  currentShares: number;
  previousShares: number;
  currentValueUsd: number;
}

interface BuyerWeight {
  weight: number;
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

function ownershipPct(shares: number, so: number): number {
  if (!so || so <= 0 || !Number.isFinite(shares) || shares <= 0) return 0;
  return round2((shares / so) * 100);
}

function ownershipGrowth(currentPct: number, previousPct: number): number {
  if (previousPct > 0) return round4((currentPct - previousPct) / previousPct);
  if (currentPct > 0) return 1;
  return 0;
}

function buildSummary(signals: HiddenGemRow[], currentQuarter: string, previousQuarter: string | null): HiddenGemSummary {
  return {
    totalGems: signals.length,
    emerging: signals.filter((s) => s.label === "Emerging").length,
    hiddenGem: signals.filter((s) => s.label === "Hidden Gem").length,
    strongAccumulation: signals.filter((s) => s.label === "Strong Accumulation").length,
    institutionalDiscovery: signals.filter((s) => s.label === "Institutional Discovery").length,
    currentQuarter,
    previousQuarter,
  };
}

function computePairRows(input: {
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>;
  currentQuarter: string;
  previousQuarter: string;
  sharesOutstanding: Map<string, number>;
  enrichment: Map<string, { companyName: string | null; sector: string | null }>;
  weightIndex: ReturnType<typeof indexPortfolioSnapshots>;
  thresholds: HiddenGemThresholds;
}): HiddenGemRow[] {
  const {
    holdings,
    currentQuarter,
    previousQuarter,
    sharesOutstanding,
    enrichment,
    weightIndex,
    thresholds,
  } = input;

  const byInstTicker = new Map<string, InstTickerState>();

  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares)) continue;
    if (h.quarter !== currentQuarter && h.quarter !== previousQuarter) continue;
    const key = `${formatSecCik(h.institutionId)}::${h.ticker}`;
    let state = byInstTicker.get(key);
    if (!state) {
      state = { currentShares: 0, previousShares: 0, currentValueUsd: 0 };
      byInstTicker.set(key, state);
    }
    if (h.quarter === currentQuarter) {
      state.currentShares += h.shares;
      state.currentValueUsd += Number(h.marketValue) || 0;
    } else {
      state.previousShares += h.shares;
    }
  }

  type Agg = {
    currentShares: number;
    previousShares: number;
    currentValueUsd: number;
    institutions: Set<string>;
    newPositions: number;
    increasing: number;
    buyerWeights: BuyerWeight[];
  };

  const byTicker = new Map<string, Agg>();

  for (const [key, state] of byInstTicker) {
    const [cik, ticker] = key.split("::");
    if (!ticker || !cik) continue;
    const cur = state.currentShares;
    const prev = state.previousShares;
    if (cur <= 0 && prev <= 0) continue;

    let agg = byTicker.get(ticker);
    if (!agg) {
      agg = {
        currentShares: 0,
        previousShares: 0,
        currentValueUsd: 0,
        institutions: new Set(),
        newPositions: 0,
        increasing: 0,
        buyerWeights: [],
      };
      byTicker.set(ticker, agg);
    }

    agg.currentShares += cur;
    agg.previousShares += prev;
    agg.currentValueUsd += state.currentValueUsd;
    if (cur > 0) agg.institutions.add(cik);

    const delta = cur - prev;
    const isNew = prev <= 0 && cur > 0;
    const isIncrease = delta > 0 && cur > 0;
    if (isNew) agg.newPositions += 1;
    if (isIncrease) agg.increasing += 1;

    if (isIncrease) {
      const snap = weightIndex.get(cik)?.get(currentQuarter);
      const w = snap?.weights?.[ticker];
      if (typeof w === "number" && Number.isFinite(w) && w > 0) {
        agg.buyerWeights.push({ weight: w });
      }
    }
  }

  const rows: HiddenGemRow[] = [];

  for (const [ticker, agg] of byTicker) {
    const so = sharesOutstanding.get(ticker);
    if (!so || so <= 0) continue;

    const institutionalOwnership = ownershipPct(agg.currentShares, so);
    const previousInstitutionalOwnership = ownershipPct(agg.previousShares, so);
    const growth = ownershipGrowth(institutionalOwnership, previousInstitutionalOwnership);
    const netShares = round2(agg.currentShares - agg.previousShares);
    const ownershipChangePctPoints = round2(institutionalOwnership - previousInstitutionalOwnership);

    const weights = agg.buyerWeights.map((b) => b.weight);
    const avgWeight = weights.length ? weights.reduce((s, w) => s + w, 0) / weights.length : 0;
    const medianWeight = median(weights);
    const highConvictionBuyers = weights.filter((w) => w > 0.02).length;

    const convictionScore = computeConvictionScore({
      avgWeight,
      medianWeight,
      highConvictionCount: highConvictionBuyers,
      buyerCount: weights.length,
    });

    const impliedPx =
      agg.currentShares > 0 ? agg.currentValueUsd / agg.currentShares : null;
    const marketCapUsd =
      impliedPx != null && impliedPx > 0 ? round2(so * impliedPx) : null;

    const draft = {
      institutionalOwnership,
      ownershipGrowth: growth,
      increasingPositionsCount: agg.increasing,
      netSharesAccumulated: netShares,
      marketCapUsd,
    };
    if (!qualifiesAsHiddenGem(draft, thresholds)) continue;

    const hiddenGemScore = computeHiddenGemScore({
      ownershipGrowth: growth,
      newPositionsCount: agg.newPositions,
      netShares,
      previousShares: agg.previousShares,
      convictionScore,
      institutionalOwnership,
      maxOwnershipPct: thresholds.maxInstitutionalOwnershipPct,
    });

    const meta = enrichment.get(ticker);
    rows.push({
      ticker,
      companyName: meta?.companyName ?? null,
      sector: meta?.sector ?? null,
      marketCapUsd,
      institutionalOwnership,
      previousInstitutionalOwnership,
      ownershipGrowth: growth,
      ownershipChangePctPoints,
      institutionsCount: agg.institutions.size,
      newPositionsCount: agg.newPositions,
      increasingPositionsCount: agg.increasing,
      netSharesAccumulated: netShares,
      avgBuyerPortfolioWeight: round4(avgWeight),
      medianBuyerPortfolioWeight: round4(medianWeight),
      highConvictionBuyers,
      convictionScore: round1(convictionScore),
      hiddenGemScore,
      label: labelForScore(hiddenGemScore),
      quarter: currentQuarter,
      previousQuarter,
    });
  }

  return rows;
}

/** Heavy compute — prefer warm cache. Uses tracked 13F holdings only. */
export async function computeHiddenGems(
  pool: pg.Pool = getPool(),
  thresholds: HiddenGemThresholds = DEFAULT_HIDDEN_GEM_THRESHOLDS
): Promise<HiddenGemsCachePayload> {
  const [holdings, sharesOutstanding] = await Promise.all([
    loadInstitutionHoldings(pool, undefined, { maxQuarters: 2 }),
    loadSharesOutstanding(pool),
  ]);

  const quarters = sortQuarters([...new Set(holdings.map((h) => h.quarter).filter(Boolean))]);
  const currentQuarter = quarters[quarters.length - 1] ?? "";
  const previousQuarter = quarters.length >= 2 ? quarters[quarters.length - 2] : null;

  const weightIndex = indexPortfolioSnapshots(buildPortfolioSnapshots(holdings));

  const tickers = [
    ...new Set(
      holdings
        .map((h) => (h.ticker ? String(h.ticker).trim().toUpperCase() : ""))
        .filter(Boolean)
    ),
  ];
  const enrichment = await loadStockEnrichment(pool, tickers);

  const signals: HiddenGemRow[] = [];

  // Build gems for each consecutive quarter pair (supports quarter filter).
  for (let i = 1; i < quarters.length; i++) {
    const prevQ = quarters[i - 1];
    const curQ = quarters[i];
    signals.push(
      ...computePairRows({
        holdings,
        currentQuarter: curQ,
        previousQuarter: prevQ,
        sharesOutstanding,
        enrichment,
        weightIndex,
        thresholds,
      })
    );
  }

  signals.sort(
    (a, b) =>
      b.hiddenGemScore - a.hiddenGemScore ||
      b.ownershipGrowth - a.ownershipGrowth ||
      a.ticker.localeCompare(b.ticker)
  );

  const latestSignals = currentQuarter
    ? signals.filter((s) => s.quarter === currentQuarter)
    : signals;

  const sectors = [
    ...new Set(signals.map((s) => s.sector).filter((s): s is string => !!s)),
  ].sort((a, b) => a.localeCompare(b));

  const pairQuarters = [
    ...new Set(signals.map((s) => s.quarter).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  return {
    computedAt: new Date().toISOString(),
    currentQuarter,
    previousQuarter,
    quarters: pairQuarters.length ? pairQuarters : currentQuarter ? [currentQuarter] : [],
    thresholds,
    summary: buildSummary(latestSignals, currentQuarter, previousQuarter),
    sectors,
    signals,
  };
}

