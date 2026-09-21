import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadStockSignalsSchemaSql } from "../db/schema.js";
import type { StockSignal } from "./stockSignals.js";

const UPSERT_SQL = `
INSERT INTO stock_signal (
  ticker, category, label, direction, strength,
  buy_value_usd, sell_value_usd, net_value_usd, ratio, computed_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
ON CONFLICT (ticker, category) DO UPDATE SET
  label = EXCLUDED.label,
  direction = EXCLUDED.direction,
  strength = EXCLUDED.strength,
  buy_value_usd = EXCLUDED.buy_value_usd,
  sell_value_usd = EXCLUDED.sell_value_usd,
  net_value_usd = EXCLUDED.net_value_usd,
  ratio = EXCLUDED.ratio,
  computed_at = NOW()
`.trim();

/** Flow categories persisted for the stock Signals tab. */
export const FLOW_SIGNAL_CATEGORIES = ["institutional", "insider", "politician"] as const;

interface StockSignalRow {
  category: string;
  label: string;
  direction: string;
  strength: string;
  buy_value_usd: number | null;
  sell_value_usd: number | null;
  net_value_usd: number | null;
  ratio: number | null;
  computed_at: string | Date;
}

function mapRow(r: StockSignalRow): StockSignal & { computedAt: string } {
  return {
    category: r.category as StockSignal["category"],
    label: r.label,
    direction: r.direction as StockSignal["direction"],
    strength: r.strength as StockSignal["strength"],
    buyValueUsd: Number(r.buy_value_usd ?? 0),
    sellValueUsd: Number(r.sell_value_usd ?? 0),
    netValueUsd: Number(r.net_value_usd ?? 0),
    ratio: r.ratio != null ? Number(r.ratio) : null,
    computedAt:
      r.computed_at instanceof Date ? r.computed_at.toISOString() : String(r.computed_at),
  };
}

export class StockSignalsRepository {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: pg.Pool = getPool()) {}

  async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool
        .query(loadStockSignalsSchemaSql())
        .then(() => undefined)
        .catch((err) => {
          this.schemaReady = null;
          throw err;
        });
    }
    await this.schemaReady;
  }

  async saveSignals(ticker: string, signals: StockSignal[]): Promise<void> {
    const sym = String(ticker || "").trim().toUpperCase();
    if (!sym || !signals.length) return;
    await this.ensureSchema();
    for (const s of signals) {
      await this.pool.query(UPSERT_SQL, [
        sym,
        s.category,
        s.label,
        s.direction,
        s.strength,
        s.buyValueUsd,
        s.sellValueUsd,
        s.netValueUsd,
        s.ratio,
      ]);
    }
  }

  async getSignals(ticker: string): Promise<Array<StockSignal & { computedAt: string }>> {
    const sym = String(ticker || "").trim().toUpperCase();
    if (!sym) return [];
    try {
      await this.ensureSchema();
    } catch {
      return [];
    }
    const res = await this.pool.query<StockSignalRow>(
      `SELECT category, label, direction, strength,
              buy_value_usd, sell_value_usd, net_value_usd, ratio, computed_at
       FROM stock_signal WHERE ticker = $1`,
      [sym]
    );
    return res.rows.map(mapRow);
  }

  /**
   * Load the three flow signals when all categories are present.
   * If maxAgeMs > 0, reject when the oldest row is older than that.
   * Pass maxAgeMs = 0 (or omit) to accept any age.
   */
  async getFlowSignals(
    ticker: string,
    maxAgeMs = 0
  ): Promise<{ signals: StockSignal[]; computedAt: string; ageMs: number } | null> {
    const sym = String(ticker || "").trim().toUpperCase();
    if (!sym) return null;
    try {
      await this.ensureSchema();
    } catch {
      return null;
    }

    const res = await this.pool.query<StockSignalRow>(
      `SELECT category, label, direction, strength,
              buy_value_usd, sell_value_usd, net_value_usd, ratio, computed_at
       FROM stock_signal
       WHERE ticker = $1
         AND category = ANY($2::text[])`,
      [sym, [...FLOW_SIGNAL_CATEGORIES]]
    );
    if (res.rows.length < FLOW_SIGNAL_CATEGORIES.length) return null;

    const byCategory = new Map(res.rows.map((r) => [r.category, r]));
    if (FLOW_SIGNAL_CATEGORIES.some((c) => !byCategory.has(c))) return null;

    let oldestMs = Number.POSITIVE_INFINITY;
    let computedAt = "";
    for (const c of FLOW_SIGNAL_CATEGORIES) {
      const row = byCategory.get(c)!;
      const at =
        row.computed_at instanceof Date
          ? row.computed_at.getTime()
          : Date.parse(String(row.computed_at));
      if (!Number.isFinite(at)) return null;
      if (at < oldestMs) {
        oldestMs = at;
        computedAt =
          row.computed_at instanceof Date
            ? row.computed_at.toISOString()
            : String(row.computed_at);
      }
    }

    const ageMs = Date.now() - oldestMs;
    if (maxAgeMs > 0 && ageMs > maxAgeMs) return null;

    return {
      ageMs,
      computedAt,
      signals: FLOW_SIGNAL_CATEGORIES.map((c) => {
        const { computedAt: _c, ...signal } = mapRow(byCategory.get(c)!);
        return signal;
      }),
    };
  }

  /** Convenience: fresh within maxAgeMs. */
  async getFreshFlowSignals(
    ticker: string,
    maxAgeMs: number
  ): Promise<{ signals: StockSignal[]; computedAt: string } | null> {
    const hit = await this.getFlowSignals(ticker, maxAgeMs);
    if (!hit) return null;
    return { signals: hit.signals, computedAt: hit.computedAt };
  }
}

let defaultRepo: StockSignalsRepository | null = null;

export function getStockSignalsRepository(pool?: pg.Pool): StockSignalsRepository {
  if (pool) return new StockSignalsRepository(pool);
  if (!defaultRepo) defaultRepo = new StockSignalsRepository();
  return defaultRepo;
}
