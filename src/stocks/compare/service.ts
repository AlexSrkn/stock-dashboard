import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  buildInstitutionalSide,
  buildInstitutionOverlap,
} from "./institutional.js";
import { buildInsiderOverlap, buildInsiderSide } from "./insiders.js";
import { buildPoliticianOverlap, buildPoliticianSide } from "./politicians.js";
import {
  activeSignalLabels,
  buildSignalsSide,
  highlightScore,
} from "./signals.js";
import { buildCompareTimeline } from "./timeline.js";
import { parseComparePeriod, periodStartDate } from "./period.js";
import type {
  ComparePeriod,
  CompareStockSide,
  StockComparePayload,
} from "./types.js";

const SELECT_STOCK_META_SQL = `
SELECT ticker, company_name, sector
FROM stocks
WHERE ticker = ANY($1::varchar[])
`.trim();

async function loadStockMeta(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  if (!tickers.length) return out;
  try {
    const res = await pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
    }>(SELECT_STOCK_META_SQL, [tickers]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        companyName: row.company_name ? String(row.company_name) : null,
        sector: row.sector ? String(row.sector) : null,
      });
    }
  } catch {
    /* stocks table optional */
  }
  return out;
}

function buildSideSummary(
  institutional: CompareStockSide["institutional"],
  insiders: CompareStockSide["insiders"],
  politicians: CompareStockSide["politicians"],
  signals: CompareStockSide["signals"]
): CompareStockSide["summary"] {
  return {
    institutionalHolders: institutional.holderCount,
    newPositions: institutional.newPositions,
    insiderBuyers: insiders.uniqueBuyers,
    politicianBuyers: politicians.uniqueBuyers,
    activeSignals: activeSignalLabels(signals),
    highlightScore: highlightScore(signals),
  };
}

export class StockCompareError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function compareStocks(
  tickerARaw: string,
  tickerBRaw: string,
  periodRaw: string | null = "latest",
  pool: pg.Pool = getPool()
): Promise<StockComparePayload> {
  const tickerA = String(tickerARaw || "").trim().toUpperCase();
  const tickerB = String(tickerBRaw || "").trim().toUpperCase();
  const period: ComparePeriod = parseComparePeriod(periodRaw);

  if (!tickerA || !tickerB) {
    throw new StockCompareError(400, "missing_tickers", "Both tickerA and tickerB are required.");
  }
  if (tickerA === tickerB) {
    throw new StockCompareError(400, "same_ticker", "Select two different stocks to compare.");
  }

  const start = periodStartDate(period);
  const meta = await loadStockMeta(pool, [tickerA, tickerB]);

  const [instA, instB, insiderA, insiderB] = await Promise.all([
    buildInstitutionalSide(pool, tickerA),
    buildInstitutionalSide(pool, tickerB),
    buildInsiderSide(pool, tickerA, start),
    buildInsiderSide(pool, tickerB, start),
  ]);

  const polA = buildPoliticianSide(tickerA, start);
  const polB = buildPoliticianSide(tickerB, start);
  const signalsA = buildSignalsSide(tickerA, period);
  const signalsB = buildSignalsSide(tickerB, period);

  const timeline = await buildCompareTimeline(
    pool,
    tickerA,
    tickerB,
    period,
    insiderA.transactions,
    insiderB.transactions,
    polA.trades,
    polB.trades
  );

  const stockA: CompareStockSide = {
    ticker: tickerA,
    companyName: meta.get(tickerA)?.companyName ?? null,
    sector: meta.get(tickerA)?.sector ?? null,
    institutional: instA,
    insiders: insiderA.stats,
    politicians: polA.stats,
    signals: signalsA,
    summary: buildSideSummary(instA, insiderA.stats, polA.stats, signalsA),
  };
  const stockB: CompareStockSide = {
    ticker: tickerB,
    companyName: meta.get(tickerB)?.companyName ?? null,
    sector: meta.get(tickerB)?.sector ?? null,
    institutional: instB,
    insiders: insiderB.stats,
    politicians: polB.stats,
    signals: signalsB,
    summary: buildSideSummary(instB, insiderB.stats, polB.stats, signalsB),
  };

  const instOverlap = buildInstitutionOverlap(instA, instB);
  const insiderOverlap = buildInsiderOverlap(insiderA.transactions, insiderB.transactions);
  const politicianOverlap = buildPoliticianOverlap(polA.trades, polB.trades);

  const payload: StockComparePayload = {
    computedAt: new Date().toISOString(),
    period,
    stockA,
    stockB,
    overlap: {
      institutions: instOverlap,
      insiders: insiderOverlap,
      politicians: politicianOverlap,
    },
    timeline,
  };
  // Don't ship the wide overlap helper lists to the client.
  delete payload.stockA.institutional.holdersForOverlap;
  delete payload.stockB.institutional.holdersForOverlap;
  return payload;
}

export async function getStockCompare(url: URL, pool: pg.Pool = getPool()): Promise<StockComparePayload> {
  return compareStocks(
    url.searchParams.get("tickerA") || "",
    url.searchParams.get("tickerB") || "",
    url.searchParams.get("period"),
    pool
  );
}
