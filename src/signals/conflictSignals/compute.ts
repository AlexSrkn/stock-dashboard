import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import { sortQuarters } from "../../institution/performance/quarters.js";
import {
  SELECT_OPEN_MARKET_INSIDER_FLOW_SQL,
  SELECT_SHARES_OUTSTANDING_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
} from "./queries.js";
import {
  classifyInsiderRoles,
  computeInsiderScore,
  computeInstitutionScore,
  conflictScore,
  detectSignalTypes,
  emptyInsiderRoles,
  isCLevelTitle,
  mergeRoles,
  pickPrimarySignalType,
  round1,
  round2,
} from "./score.js";
import type {
  ConflictSignalInsiderRoles,
  ConflictSignalRow,
  ConflictSignalSummary,
  ConflictSignalsCachePayload,
} from "./types.js";

const DEFAULT_INSIDER_WINDOW_DAYS = 90;

interface InstTickerState {
  currentShares: number;
  previousShares: number;
  currentValueUsd: number;
}

interface InstAgg {
  netSharesAdded: number;
  previousShares: number;
  currentShares: number;
  currentValueUsd: number;
  institutionsIncreasing: number;
  institutionsReducing: number;
  newPositions: number;
  fullyExited: number;
}

interface InsiderAgg {
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  uniqueBuyers: Set<string>;
  uniqueSellers: Set<string>;
  cLevelSellers: number;
  cLevelBuyers: number;
  roles: ConflictSignalInsiderRoles;
}

function ownershipChangePct(net: number, previous: number): number {
  if (previous > 0) return round2((net / previous) * 100);
  if (net > 0) return 100;
  if (net < 0) return -100;
  return 0;
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

function aggregateInstitutional(
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>,
  currentQuarter: string,
  previousQuarter: string | null
): Map<string, InstAgg> {
  const byInstTicker = new Map<string, InstTickerState>();

  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares)) continue;
    const key = `${h.institutionId}::${h.ticker}`;
    let state = byInstTicker.get(key);
    if (!state) {
      state = { currentShares: 0, previousShares: 0, currentValueUsd: 0 };
      byInstTicker.set(key, state);
    }
    if (h.quarter === currentQuarter) {
      state.currentShares += h.shares;
      state.currentValueUsd += Number(h.marketValue) || 0;
    } else if (previousQuarter && h.quarter === previousQuarter) {
      state.previousShares += h.shares;
    }
  }

  const byTicker = new Map<string, InstAgg>();

  for (const [key, state] of byInstTicker) {
    const ticker = key.split("::")[1];
    if (!ticker) continue;
    const cur = state.currentShares;
    const prev = state.previousShares;
    if (cur <= 0 && prev <= 0) continue;

    let agg = byTicker.get(ticker);
    if (!agg) {
      agg = {
        netSharesAdded: 0,
        previousShares: 0,
        currentShares: 0,
        currentValueUsd: 0,
        institutionsIncreasing: 0,
        institutionsReducing: 0,
        newPositions: 0,
        fullyExited: 0,
      };
      byTicker.set(ticker, agg);
    }

    const delta = cur - prev;
    agg.netSharesAdded += delta;
    agg.previousShares += prev;
    agg.currentShares += cur;
    agg.currentValueUsd += state.currentValueUsd;

    if (prev <= 0 && cur > 0) {
      agg.newPositions += 1;
      agg.institutionsIncreasing += 1;
    } else if (prev > 0 && cur <= 0) {
      agg.fullyExited += 1;
      agg.institutionsReducing += 1;
    } else if (delta > 0) {
      agg.institutionsIncreasing += 1;
    } else if (delta < 0) {
      agg.institutionsReducing += 1;
    }
  }

  return byTicker;
}

async function aggregateInsiders(
  pool: pg.Pool,
  windowDays: number
): Promise<Map<string, InsiderAgg>> {
  const res = await pool.query<{
    ticker: string;
    insider_name: string;
    insider_title: string | null;
    transaction_value: number;
    shares: number;
    transaction_code: string;
  }>(SELECT_OPEN_MARKET_INSIDER_FLOW_SQL, [windowDays]);

  const byTicker = new Map<string, InsiderAgg>();

  for (const row of res.rows) {
    const ticker = String(row.ticker || "")
      .trim()
      .toUpperCase();
    if (!ticker) continue;
    const code = String(row.transaction_code || "").toUpperCase();
    const name = String(row.insider_name || "").trim() || "Unknown";
    let value = Number(row.transaction_value) || 0;
    if (value <= 0) {
      // Fall back to share count as a weak volume proxy when value missing
      value = Math.abs(Number(row.shares) || 0);
    }
    if (value <= 0) continue;

    let agg = byTicker.get(ticker);
    if (!agg) {
      agg = {
        buyVolumeUsd: 0,
        sellVolumeUsd: 0,
        uniqueBuyers: new Set(),
        uniqueSellers: new Set(),
        cLevelSellers: 0,
        cLevelBuyers: 0,
        roles: emptyInsiderRoles(),
      };
      byTicker.set(ticker, agg);
    }

    const roles = classifyInsiderRoles(row.insider_title);
    const cLevel = isCLevelTitle(row.insider_title);

    if (code === "P") {
      agg.buyVolumeUsd += value;
      if (!agg.uniqueBuyers.has(name)) {
        agg.uniqueBuyers.add(name);
        if (cLevel) agg.cLevelBuyers += 1;
      }
      agg.roles = mergeRoles(agg.roles, roles);
    } else if (code === "S") {
      agg.sellVolumeUsd += value;
      if (!agg.uniqueSellers.has(name)) {
        agg.uniqueSellers.add(name);
        if (cLevel) agg.cLevelSellers += 1;
      }
      agg.roles = mergeRoles(agg.roles, roles);
    }
  }

  return byTicker;
}

function buildSummary(
  signals: ConflictSignalRow[],
  currentQuarter: string,
  previousQuarter: string | null
): ConflictSignalSummary {
  return {
    totalSignals: signals.length,
    bullishConflicts: signals.filter((s) =>
      s.signalTypes.includes("institutions_buying_insiders_selling")
    ).length,
    bearishConflicts: signals.filter((s) =>
      s.signalTypes.includes("institutions_selling_insiders_buying")
    ).length,
    strongDivergences: signals.filter((s) => s.signalTypes.includes("strong_divergence")).length,
    doubleConviction: signals.filter((s) =>
      s.signalTypes.includes("double_conviction_conflict")
    ).length,
    currentQuarter,
    previousQuarter,
  };
}

/** Heavy compute — prefer warm cache script over live request. */
export async function computeConflictSignals(
  pool: pg.Pool = getPool(),
  insiderWindowDays = DEFAULT_INSIDER_WINDOW_DAYS
): Promise<ConflictSignalsCachePayload> {
  const [holdings, insiderByTicker, sharesOutstanding] = await Promise.all([
    loadInstitutionHoldings(pool, undefined, { maxQuarters: 2 }),
    aggregateInsiders(pool, insiderWindowDays),
    loadSharesOutstanding(pool),
  ]);

  const quarters = sortQuarters([...new Set(holdings.map((h) => h.quarter))]);
  const currentQuarter = quarters[quarters.length - 1] ?? "";
  const previousQuarter = quarters.length >= 2 ? quarters[quarters.length - 2] : null;
  const instByTicker = aggregateInstitutional(holdings, currentQuarter, previousQuarter);

  const tickers = [
    ...new Set([...instByTicker.keys(), ...insiderByTicker.keys()]),
  ].sort();
  const enrichment = await loadStockEnrichment(pool, tickers);

  const signals: ConflictSignalRow[] = [];

  for (const ticker of tickers) {
    const inst = instByTicker.get(ticker);
    const insider = insiderByTicker.get(ticker);
    if (!inst || !insider) continue;

    const hasInstActivity =
      inst.institutionsIncreasing +
        inst.institutionsReducing +
        inst.newPositions +
        inst.fullyExited >
      0;
    const hasInsiderActivity = insider.buyVolumeUsd > 0 || insider.sellVolumeUsd > 0;
    if (!hasInstActivity || !hasInsiderActivity) continue;

    const ownPct = ownershipChangePct(inst.netSharesAdded, inst.previousShares);
    const institutionScore = computeInstitutionScore({
      institutionsIncreasing: inst.institutionsIncreasing,
      institutionsReducing: inst.institutionsReducing,
      newPositions: inst.newPositions,
      fullyExited: inst.fullyExited,
      ownershipChangePct: ownPct,
    });
    const insiderScore = computeInsiderScore({
      buyVolumeUsd: insider.buyVolumeUsd,
      sellVolumeUsd: insider.sellVolumeUsd,
      uniqueBuyers: insider.uniqueBuyers.size,
      uniqueSellers: insider.uniqueSellers.size,
    });

    const signalTypes = detectSignalTypes({
      institutionScore,
      insiderScore,
      institutionsBuyingCount: inst.institutionsIncreasing,
      cLevelSellers: insider.cLevelSellers,
    });
    const signalType = pickPrimarySignalType(signalTypes);
    if (!signalType) continue;

    const so = sharesOutstanding.get(ticker);
    const impliedPx =
      inst.currentShares > 0 ? inst.currentValueUsd / inst.currentShares : null;
    const marketCapUsd =
      so != null && impliedPx != null && impliedPx > 0 ? round2(so * impliedPx) : null;

    const meta = enrichment.get(ticker);

    signals.push({
      ticker,
      companyName: meta?.companyName ?? null,
      sector: meta?.sector ?? null,
      marketCapUsd,
      institutionScore,
      insiderScore,
      conflictScore: conflictScore(institutionScore, insiderScore),
      signalType,
      signalTypes,
      institutionsBuyingCount: inst.institutionsIncreasing,
      institutionsSellingCount: inst.institutionsReducing,
      insidersBuyingCount: insider.uniqueBuyers.size,
      insidersSellingCount: insider.uniqueSellers.size,
      newPositions: inst.newPositions,
      fullyExited: inst.fullyExited,
      netSharesAdded: round2(inst.netSharesAdded),
      ownershipChangePct: ownPct,
      insiderBuyVolumeUsd: round2(insider.buyVolumeUsd),
      insiderSellVolumeUsd: round2(insider.sellVolumeUsd),
      cLevelSellers: insider.cLevelSellers,
      cLevelBuyers: insider.cLevelBuyers,
      insiderRoles: insider.roles,
      currentQuarter,
    });
  }

  signals.sort(
    (a, b) =>
      b.conflictScore - a.conflictScore ||
      Math.abs(b.institutionScore) - Math.abs(a.institutionScore) ||
      a.ticker.localeCompare(b.ticker)
  );

  const sectors = [
    ...new Set(signals.map((s) => s.sector).filter((s): s is string => !!s)),
  ].sort((a, b) => a.localeCompare(b));

  return {
    computedAt: new Date().toISOString(),
    currentQuarter,
    previousQuarter,
    insiderWindowDays,
    summary: buildSummary(signals, currentQuarter, previousQuarter),
    sectors,
    signals,
  };
}

export { DEFAULT_INSIDER_WINDOW_DAYS };

