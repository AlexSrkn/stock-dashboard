import type pg from "pg";
import { getPool } from "../db/pool.js";
import { buildInsiderClusterSignals } from "./clusterEngine.js";
import {
  getCachedInsiderClusterForTicker,
  getCachedInsiderClusterSignals,
  getOrComputeInsiderClusterSignals,
} from "./cache.js";
import { loadInsiderBuyRows } from "./dataLoader.js";
import {
  CLUSTER_LOOKBACK_OPTIONS,
  DEFAULT_CLUSTER_LOOKBACK_DAYS,
  type ClusterLookbackDays,
  type InsiderClusterListPayload,
  type InsiderClusterSignal,
} from "./types.js";

export function parseClusterLookbackDays(raw: string | null | undefined): ClusterLookbackDays {
  const n = Number(raw);
  if (n === 30 || n === 60 || n === 90) return n;
  return DEFAULT_CLUSTER_LOOKBACK_DAYS;
}

export class InsiderClusterService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async computeAll(lookbackDays: ClusterLookbackDays): Promise<InsiderClusterSignal[]> {
    const rows = await loadInsiderBuyRows(lookbackDays, this.pool);
    return buildInsiderClusterSignals(rows, lookbackDays);
  }

  async getAllSignals(
    lookbackDays: ClusterLookbackDays = DEFAULT_CLUSTER_LOOKBACK_DAYS,
    opts: { limit?: number; alertsOnly?: boolean } = {}
  ): Promise<InsiderClusterListPayload> {
    const signals = await getOrComputeInsiderClusterSignals(lookbackDays, () =>
      this.computeAll(lookbackDays)
    );

    let filtered = signals;
    if (opts.alertsOnly) filtered = filtered.filter((s) => s.clusterAlert);

    if (opts.limit != null) {
      filtered = filtered.slice(0, Math.max(1, opts.limit));
    }

    return {
      computedAt: new Date().toISOString(),
      lookbackDays,
      count: signals.length,
      signals: filtered,
    };
  }

  async getForTicker(
    ticker: string,
    lookbackDays: ClusterLookbackDays = DEFAULT_CLUSTER_LOOKBACK_DAYS
  ): Promise<InsiderClusterSignal | null> {
    const sym = String(ticker || "").trim().toUpperCase();
    if (!sym) return null;

    const cached = getCachedInsiderClusterForTicker(sym, lookbackDays);
    if (cached) return cached;

    await getOrComputeInsiderClusterSignals(lookbackDays, () => this.computeAll(lookbackDays));
    return getCachedInsiderClusterForTicker(sym, lookbackDays);
  }
}

let defaultService: InsiderClusterService | null = null;

export function getInsiderClusterService(): InsiderClusterService {
  if (!defaultService) defaultService = new InsiderClusterService();
  return defaultService;
}

export { CLUSTER_LOOKBACK_OPTIONS, DEFAULT_CLUSTER_LOOKBACK_DAYS };
