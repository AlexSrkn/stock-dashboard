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

export class StockSignalsRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(loadStockSignalsSchemaSql());
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

  async getSignals(ticker: string): Promise<
    Array<StockSignal & { computedAt: string }>
  > {
    const sym = String(ticker || "").trim().toUpperCase();
    if (!sym) return [];
    const res = await this.pool.query<StockSignalRow>(
      `SELECT category, label, direction, strength,
              buy_value_usd, sell_value_usd, net_value_usd, ratio, computed_at
       FROM stock_signal WHERE ticker = $1`,
      [sym]
    );
    return res.rows.map((r) => ({
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
    }));
  }
}

let defaultRepo: StockSignalsRepository | null = null;

export function getStockSignalsRepository(pool?: pg.Pool): StockSignalsRepository {
  if (pool) return new StockSignalsRepository(pool);
  if (!defaultRepo) defaultRepo = new StockSignalsRepository();
  return defaultRepo;
}
