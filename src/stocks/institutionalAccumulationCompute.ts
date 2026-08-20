import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadInstitutionHoldings } from "../institution/performance/holdingsLoader.js";
import { sortQuarters } from "../institution/performance/quarters.js";
import { trackedInstitutionCiks } from "../institution/mostAccumulated/queries.js";
import type { InstitutionalAccumulationPayload, InstitutionalAccumulationRow } from "./institutionalAccumulationTypes.js";

function roundShares(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Heavy compute — run via warm-cache script, not on every API request. */
export async function computeInstitutionalShareAccumulation(
  pool: pg.Pool = getPool()
): Promise<InstitutionalAccumulationPayload> {
  // Curated seed only — full imported universe OOMs the 4GB VPS during warm.
  const holdings = await loadInstitutionHoldings(pool, trackedInstitutionCiks(), { maxQuarters: 2 });
  const quarters = sortQuarters([...new Set(holdings.map((h) => h.quarter))]);
  const currentQuarter = quarters[quarters.length - 1] ?? "";
  const previousQuarter = quarters.length >= 2 ? quarters[quarters.length - 2] : null;

  const curByInstTicker = new Map<string, number>();
  const prevByInstTicker = new Map<string, number>();

  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares)) continue;
    const key = `${h.institutionId}::${h.ticker}`;
    if (h.quarter === currentQuarter) {
      curByInstTicker.set(key, (curByInstTicker.get(key) ?? 0) + h.shares);
    } else if (previousQuarter && h.quarter === previousQuarter) {
      prevByInstTicker.set(key, (prevByInstTicker.get(key) ?? 0) + h.shares);
    }
  }

  const byTicker = new Map<string, InstitutionalAccumulationRow>();

  for (const [key, curShares] of curByInstTicker) {
    const ticker = key.split("::")[1];
    if (!ticker) continue;
    const prevShares = prevByInstTicker.get(key) ?? 0;
    const delta = curShares - prevShares;
    if (delta <= 0) continue;

    let row = byTicker.get(ticker);
    if (!row) {
      row = {
        ticker,
        sharesBought: 0,
        currentShares: 0,
        previousShares: 0,
        institutionCount: 0,
      };
      byTicker.set(ticker, row);
    }
    row.sharesBought = roundShares(row.sharesBought + delta);
    row.currentShares = roundShares(row.currentShares + curShares);
    row.previousShares = roundShares(row.previousShares + prevShares);
    row.institutionCount += 1;
  }

  const stocks = [...byTicker.values()].sort((a, b) => b.sharesBought - a.sharesBought);

  return {
    computedAt: new Date().toISOString(),
    currentQuarter,
    previousQuarter,
    count: stocks.length,
    stocks,
  };
}
