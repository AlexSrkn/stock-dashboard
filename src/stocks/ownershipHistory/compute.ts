import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../../institution/performance/holdingsLoader.js";
import { sortQuarters } from "../../institution/performance/quarters.js";
import { formatSecCik } from "../../sec/http.js";
import { normalizeTicker } from "../../politicians/byTicker.js";
import { readPoliticiansRecent } from "../../politicians/recent.js";
import {
  SELECT_INSIDER_FLOW_COUNTS_SQL,
  SELECT_SHARES_OUTSTANDING_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
} from "./queries.js";
import {
  earlyDiscoveryScore,
  institutionalAdoptionScore,
  ownershipDeclineScore,
  ownershipExpansionScore,
  pickCategory,
  round2,
} from "./score.js";
import type {
  OwnershipHistoryCachePayload,
  OwnershipHistoryRow,
} from "./types.js";

const INSIDER_WINDOW_DAYS = 180;

interface QuarterTickerState {
  shares: number;
  valueUsd: number;
  institutions: Set<string>;
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

async function loadStockMeta(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  if (!tickers.length) return out;
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
  return out;
}

async function loadInsiderCounts(
  pool: pg.Pool,
  windowDays: number
): Promise<Map<string, { buys: number; sells: number }>> {
  const out = new Map<string, { buys: number; sells: number }>();
  try {
    const res = await pool.query<{
      ticker: string;
      buy_count: number;
      sell_count: number;
    }>(SELECT_INSIDER_FLOW_COUNTS_SQL, [windowDays]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        buys: Number(row.buy_count) || 0,
        sells: Number(row.sell_count) || 0,
      });
    }
  } catch {
    /* optional */
  }
  return out;
}

function loadPoliticianBuyCounts(windowDays: number): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const payload = readPoliticiansRecent();
    if (!payload) return out;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    for (const bundle of [...payload.house, ...payload.senate]) {
      for (const trade of bundle.trades || []) {
        if (trade.transactionCategory !== "buy") continue;
        let ticker = normalizeTicker(trade.ticker || "");
        if (!ticker) {
          const paren = trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
          ticker = paren ? normalizeTicker(paren[1]) : "";
        }
        if (!ticker) continue;
        const dateRaw = trade.transactionDate || trade.notificationDate || trade.filingDate || null;
        const ms = dateRaw ? Date.parse(dateRaw) : 0;
        if (ms && ms < cutoff) continue;
        out.set(ticker, (out.get(ticker) ?? 0) + 1);
      }
    }
  } catch {
    /* optional */
  }
  return out;
}

function buildQuarterMaps(
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>,
  quarters: string[]
): Map<string, Map<string, QuarterTickerState>> {
  const byQuarter = new Map<string, Map<string, QuarterTickerState>>();
  const quarterSet = new Set(quarters);

  for (const h of holdings) {
    if (!quarterSet.has(h.quarter) || !h.ticker || h.shares == null || !Number.isFinite(h.shares)) {
      continue;
    }
    if (h.shares <= 0) continue;
    const ticker = String(h.ticker).trim().toUpperCase();
    let qMap = byQuarter.get(h.quarter);
    if (!qMap) {
      qMap = new Map();
      byQuarter.set(h.quarter, qMap);
    }
    let state = qMap.get(ticker);
    if (!state) {
      state = { shares: 0, valueUsd: 0, institutions: new Set() };
      qMap.set(ticker, state);
    }
    state.shares += h.shares;
    state.valueUsd += Number.isFinite(h.marketValue) ? h.marketValue : 0;
    state.institutions.add(formatSecCik(h.institutionId));
  }

  return byQuarter;
}

function consecutiveOwnershipGrowth(
  ticker: string,
  upToQuarterIndex: number,
  quarters: string[],
  byQuarter: Map<string, Map<string, QuarterTickerState>>,
  sharesOutstanding: Map<string, number>
): number {
  const so = sharesOutstanding.get(ticker);
  if (!so || so <= 0) return 0;
  let streak = 0;
  for (let i = upToQuarterIndex; i >= 1; i--) {
    const cur = byQuarter.get(quarters[i])?.get(ticker);
    const prev = byQuarter.get(quarters[i - 1])?.get(ticker);
    if (!cur || !prev || prev.shares <= 0) break;
    const curPct = (cur.shares / so) * 100;
    const prevPct = (prev.shares / so) * 100;
    if (curPct > prevPct) streak += 1;
    else break;
  }
  return streak;
}

function buildPairRows(
  currentQuarter: string,
  previousQuarter: string,
  quarterIndex: number,
  quarters: string[],
  byQuarter: Map<string, Map<string, QuarterTickerState>>,
  sharesOutstanding: Map<string, number>,
  stockMeta: Map<string, { companyName: string | null; sector: string | null }>,
  insiderCounts: Map<string, { buys: number; sells: number }>,
  politicianBuys: Map<string, number>
): OwnershipHistoryRow[] {
  const current = byQuarter.get(currentQuarter) ?? new Map();
  const previous = byQuarter.get(previousQuarter) ?? new Map();
  const tickers = new Set([...current.keys(), ...previous.keys()]);
  const rows: OwnershipHistoryRow[] = [];

  for (const ticker of tickers) {
    const cur = current.get(ticker);
    const prev = previous.get(ticker);
    if (!cur && !prev) continue;

    const so = sharesOutstanding.get(ticker);
    if (!so || so <= 0) continue;

    const curShares = cur?.shares ?? 0;
    const prevShares = prev?.shares ?? 0;
    if (curShares <= 0 && prevShares <= 0) continue;

    const curInst = cur?.institutions ?? new Set<string>();
    const prevInst = prev?.institutions ?? new Set<string>();

    let newInstitutions = 0;
    let exitedInstitutions = 0;
    for (const cik of curInst) {
      if (!prevInst.has(cik)) newInstitutions += 1;
    }
    for (const cik of prevInst) {
      if (!curInst.has(cik)) exitedInstitutions += 1;
    }

    const currentOwnership = round2((curShares / so) * 100);
    const previousOwnership = round2((prevShares / so) * 100);
    // Skip stale / mismatched shares-outstanding that produce impossible float %.
    if (currentOwnership > 100 || previousOwnership > 100) continue;
    const ownershipChange = round2(currentOwnership - previousOwnership);
    if (Math.abs(ownershipChange) > 100) continue;
    const currentHolderCount = curInst.size;
    const previousHolderCount = prevInst.size;
    const holderChange = currentHolderCount - previousHolderCount;
    const netShares = round2(curShares - prevShares);
    const valueUsd = round2(cur?.valueUsd ?? 0);

    const impliedPx = curShares > 0 ? valueUsd / curShares : null;
    const marketCapUsd =
      impliedPx != null && impliedPx > 0 ? round2(so * impliedPx) : null;

    const streak = consecutiveOwnershipGrowth(
      ticker,
      quarterIndex,
      quarters,
      byQuarter,
      sharesOutstanding
    );

    const insider = insiderCounts.get(ticker) ?? { buys: 0, sells: 0 };
    const polBuys = politicianBuys.get(ticker) ?? 0;

    const expansion = ownershipExpansionScore({
      ownershipChange,
      holderChange,
      newInstitutions,
      consecutiveGrowthQuarters: streak,
    });
    const adoption = institutionalAdoptionScore({
      currentHolderCount,
      newInstitutions,
      consecutiveGrowthQuarters: streak,
    });
    const early = earlyDiscoveryScore({
      currentOwnership,
      ownershipChange,
      newInstitutions,
      consecutiveGrowthQuarters: streak,
      insiderBuyCount: insider.buys,
      politicianBuyCount: polBuys,
    });
    const decline = ownershipDeclineScore({
      ownershipChange,
      holderChange,
      exitedInstitutions,
    });

    const category = pickCategory({
      expansion,
      adoption,
      early,
      decline,
      ownershipChange,
    });

    const meta = stockMeta.get(ticker);
    rows.push({
      ticker,
      companyName: meta?.companyName ?? null,
      sector: meta?.sector ?? null,
      marketCapUsd,
      currentInstitutionalOwnership: currentOwnership,
      previousInstitutionalOwnership: previousOwnership,
      ownershipChange,
      currentHolderCount,
      previousHolderCount,
      holderChange,
      newInstitutions,
      exitedInstitutions,
      totalInstitutionalValueUsd: valueUsd,
      netInstitutionalShares: netShares,
      consecutiveGrowthQuarters: streak,
      ownershipExpansionScore: expansion,
      institutionalAdoptionScore: adoption,
      earlyDiscoveryScore: early,
      ownershipDeclineScore: decline,
      category,
      insiderBuyCount: insider.buys,
      insiderSellCount: insider.sells,
      politicianBuyCount: polBuys,
      currentQuarter,
      previousQuarter,
    });
  }

  return rows.sort(
    (a, b) =>
      b.ownershipExpansionScore - a.ownershipExpansionScore ||
      b.ownershipChange - a.ownershipChange ||
      a.ticker.localeCompare(b.ticker)
  );
}

/** Heavy compute — prefer warm cache script. */
export async function computeOwnershipHistoryCache(
  pool: pg.Pool = getPool()
): Promise<OwnershipHistoryCachePayload> {
  const [holdings, sharesOutstanding, insiderCounts] = await Promise.all([
    loadInstitutionHoldings(pool),
    loadSharesOutstanding(pool),
    loadInsiderCounts(pool, INSIDER_WINDOW_DAYS),
  ]);
  const politicianBuys = loadPoliticianBuyCounts(INSIDER_WINDOW_DAYS);

  const quarters = sortQuarters([...new Set(holdings.map((h) => h.quarter).filter(Boolean))]);
  const byQuarterMaps = buildQuarterMaps(holdings, quarters);

  const tickers = [
    ...new Set(
      holdings
        .map((h) => (h.ticker ? String(h.ticker).trim().toUpperCase() : ""))
        .filter(Boolean)
    ),
  ];
  const stockMeta = await loadStockMeta(pool, tickers);

  const byQuarter: Record<string, OwnershipHistoryRow[]> = {};
  const pairQuarters: string[] = [];

  for (let i = 1; i < quarters.length; i++) {
    const prevQ = quarters[i - 1];
    const curQ = quarters[i];
    const rows = buildPairRows(
      curQ,
      prevQ,
      i,
      quarters,
      byQuarterMaps,
      sharesOutstanding,
      stockMeta,
      insiderCounts,
      politicianBuys
    );
    byQuarter[curQ] = rows;
    pairQuarters.push(curQ);
  }

  const currentQuarter = pairQuarters[pairQuarters.length - 1] ?? "";
  const previousQuarter =
    currentQuarter && byQuarter[currentQuarter]?.[0]?.previousQuarter
      ? byQuarter[currentQuarter][0].previousQuarter
      : quarters.length >= 2
        ? quarters[quarters.length - 2]
        : null;

  const sectors = [
    ...new Set(
      Object.values(byQuarter)
        .flat()
        .map((r) => r.sector)
        .filter((s): s is string => !!s)
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    computedAt: new Date().toISOString(),
    currentQuarter,
    previousQuarter,
    quarters: [...pairQuarters].reverse(),
    sectors,
    byQuarter,
  };
}

