import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { closeOnOrBefore, loadAllPricesBatch, type DailyBarsByTicker } from "./dataLoader.js";
import { loadInstitutionHoldings } from "./holdingsLoader.js";
import {
  filterHoldingsToLatestQuarters,
  previousQuarter,
  quartersForHoldings,
  quarterDateRange,
  quarterReturnDateRange,
  sortQuarters,
} from "./quarters.js";
import type { QuarterlyStockReturn } from "./types.js";

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export interface ReturnsMatrixEntry {
  ticker: string;
  quarter: string;
  return: number | null;
}

/**
 * Pivot table: index = ticker, columns = quarter, values = quarterly return.
 * return = (price at current 13F quarter-end / price at previous 13F quarter-end) - 1
 * Uses unadjusted closes (price return, not dividend total return).
 */
export class ReturnsMatrix {
  private readonly byTicker = new Map<string, Map<string, number | null>>();
  readonly tickers: string[];
  readonly quarters: string[];

  constructor(
    entries: ReturnsMatrixEntry[],
    opts?: { tickers?: string[]; quarters?: string[] }
  ) {
    for (const row of entries) {
      const ticker = row.ticker.toUpperCase();
      const byQ = this.byTicker.get(ticker) ?? new Map();
      byQ.set(row.quarter, row.return);
      this.byTicker.set(ticker, byQ);
    }
    this.tickers = opts?.tickers ?? [...this.byTicker.keys()].sort();
    this.quarters = opts?.quarters ?? sortQuarters(entries.map((e) => e.quarter));
  }

  get(ticker: string, quarter: string): number | null {
    return this.byTicker.get(ticker.toUpperCase())?.get(quarter) ?? null;
  }

  hasTicker(ticker: string): boolean {
    return this.byTicker.has(ticker.toUpperCase());
  }

  toRows(): QuarterlyStockReturn[] {
    const rows: QuarterlyStockReturn[] = [];
    for (const [ticker, byQ] of this.byTicker) {
      for (const [quarter, ret] of byQ) {
        rows.push({ ticker, quarter, return: ret });
      }
    }
    return rows;
  }

  static fromEntries(entries: ReturnsMatrixEntry[]): ReturnsMatrix {
    return new ReturnsMatrix(entries);
  }

  static fromDailyBars(barsByTicker: DailyBarsByTicker, quarters: string[]): ReturnsMatrix {
    const entries = computeTickerQuarterReturns(barsByTicker, quarters);
    return new ReturnsMatrix(entries, {
      tickers: [...barsByTicker.keys()].sort(),
      quarters: sortQuarters(quarters),
    });
  }

  static fromJSON(raw: string): ReturnsMatrix {
    const data = JSON.parse(raw) as {
      tickers?: string[];
      quarters?: string[];
      returns?: Record<string, Record<string, number | null>>;
    };
    const entries: ReturnsMatrixEntry[] = [];
    const returns = data.returns ?? {};
    for (const [ticker, byQ] of Object.entries(returns)) {
      for (const [quarter, ret] of Object.entries(byQ)) {
        entries.push({ ticker, quarter, return: ret });
      }
    }
    return new ReturnsMatrix(entries, {
      tickers: data.tickers,
      quarters: data.quarters,
    });
  }

  toJSON(): {
    version: number;
    builtAt: string;
    tickers: string[];
    quarters: string[];
    returns: Record<string, Record<string, number | null>>;
  } {
    const returns: Record<string, Record<string, number | null>> = {};
    for (const [ticker, byQ] of this.byTicker) {
      returns[ticker] = Object.fromEntries(byQ);
    }
    return {
      version: 1,
      builtAt: new Date().toISOString(),
      tickers: this.tickers,
      quarters: this.quarters,
      returns,
    };
  }
}

/** Compute ticker × quarter returns from preloaded daily bars (no API calls). */
export function computeTickerQuarterReturns(
  barsByTicker: DailyBarsByTicker,
  quarters: string[]
): ReturnsMatrixEntry[] {
  const uniqueQuarters = sortQuarters(quarters);
  const entries: ReturnsMatrixEntry[] = [];

  for (const [ticker, bars] of barsByTicker) {
    for (const quarter of uniqueQuarters) {
      const range = quarterReturnDateRange(quarter);
      if (!range) {
        entries.push({ ticker, quarter, return: null });
        continue;
      }
      const startPx = closeOnOrBefore(bars, range.start);
      const endPx = closeOnOrBefore(bars, range.end);
      let ret: number | null = null;
      if (startPx != null && endPx != null && startPx > 0) {
        ret = round6(endPx / startPx - 1);
      }
      entries.push({ ticker, quarter, return: ret });
    }
  }

  return entries;
}

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "ticker-quarter-returns.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let memoryMatrix: ReturnsMatrix | null = null;
let warmInflight: Promise<ReturnsMatrix> | null = null;

function tryLoadDiskCache(maxAgeMs: number | null = CACHE_MAX_AGE_MS): ReturnsMatrix | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const stat = fs.statSync(CACHE_FILE);
    if (maxAgeMs != null && Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return ReturnsMatrix.fromJSON(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function saveReturnsMatrix(matrix: ReturnsMatrix): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(matrix.toJSON(), null, 0), "utf8");
  memoryMatrix = matrix;
}

export function getReturnsMatrix(): ReturnsMatrix | null {
  if (memoryMatrix) return memoryMatrix;
  const disk = tryLoadDiskCache(null);
  if (disk) memoryMatrix = disk;
  return memoryMatrix;
}

export function requireReturnsMatrix(): ReturnsMatrix {
  const matrix = getReturnsMatrix();
  if (!matrix) {
    throw new Error(
      "Ticker-quarter returns cache is empty. Run: npm run performance:warm-cache"
    );
  }
  return matrix;
}

export function clearReturnsMatrixCache(): void {
  memoryMatrix = null;
  warmInflight = null;
}

function resolvePriceDateBoundsFromQuarters(quarters: string[]): { minDate: string; maxDate: string } {
  const sorted = sortQuarters(quarters);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start =
    quarterReturnDateRange(first)?.start ??
    quarterDateRange(previousQuarter(first) ?? first)?.end ??
    "2010-01-01";
  const end =
    quarterReturnDateRange(last)?.end ??
    quarterDateRange(last)?.end ??
    new Date().toISOString().slice(0, 10);
  return { minDate: start, maxDate: end };
}

/**
 * Batch warmup for ticker-quarter returns from live prices.
 * Yahoo Finance was removed — this now only works if a price provider is reintroduced.
 */
export async function warmReturnsMatrix(
  pool?: pg.Pool,
  opts: { tickers?: string[]; quarters?: string[]; minDate?: string; maxDate?: string } = {}
): Promise<ReturnsMatrix> {
  if (warmInflight) return warmInflight;

  warmInflight = (async () => {
    let tickers = opts.tickers;
    let quarters = opts.quarters;

    if (!tickers?.length || !quarters?.length) {
      const holdingsRaw = await loadInstitutionHoldings(pool ?? getPool());
      if (!holdingsRaw.length) {
        throw new Error("No institutional holdings in database to warm performance cache.");
      }
      const holdings = filterHoldingsToLatestQuarters(holdingsRaw, null);
      tickers = tickers?.length ? tickers : [...new Set(holdings.map((h) => h.ticker))];
      quarters = quarters?.length ? quarters : quartersForHoldings(holdings);
    }

    const { minDate, maxDate } =
      opts.minDate && opts.maxDate
        ? { minDate: opts.minDate, maxDate: opts.maxDate }
        : resolvePriceDateBoundsFromQuarters(quarters);

    console.log(
      `Warming performance cache: ${tickers.length} tickers, ${quarters.length} quarters (${minDate} → ${maxDate})…`
    );

    const batch = await loadAllPricesBatch(tickers, minDate, maxDate);
    const matrix = ReturnsMatrix.fromDailyBars(batch.barsByTicker, quarters);
    saveReturnsMatrix(matrix);

    const nonNull = matrix.toRows().filter((r) => r.return != null).length;
    console.log(
      `Performance cache ready: ${batch.withBars}/${batch.requested} tickers with price history, ` +
        `${nonNull} non-null ticker-quarter returns.`
    );
    if (batch.empty > 0) {
      console.log(
        `Skipped ${batch.empty} symbol(s) with no chart data (delisted / invalid / warrants).`
      );
    }

    return matrix;
  })().finally(() => {
    warmInflight = null;
  });

  return warmInflight;
}

/** Load disk cache on startup only — never triggers a live price batch. */
export function ensureReturnsMatrixOnStartup(): void {
  const disk = tryLoadDiskCache(null);
  if (disk) {
    memoryMatrix = disk;
    console.log(
      `Performance returns cache loaded (${disk.tickers.length} tickers, ${disk.quarters.length} quarters).`
    );
    return;
  }
  console.log("Performance returns cache missing — run: npm run performance:warm-cache");
}
