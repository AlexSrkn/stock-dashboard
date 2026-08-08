import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { computeDoubleSignalDetail, computeDoubleSignals } from "./compute.js";
import {
  getCachedDoubleSignal,
  getOrComputeDoubleSignal,
} from "./cache.js";
import type { DoubleSignalDetailPayload, DoubleSignalPayload, DoubleSignalWindowDays } from "./types.js";
import { DEFAULT_DOUBLE_SIGNAL_WINDOW, DOUBLE_SIGNAL_WINDOW_OPTIONS } from "./types.js";

export function parseDoubleSignalWindowDays(raw: string | null | undefined): DoubleSignalWindowDays {
  const n = Number(raw);
  if (n === 90 || n === 180 || n === 365) return n;
  return DEFAULT_DOUBLE_SIGNAL_WINDOW;
}

export { DEFAULT_DOUBLE_SIGNAL_WINDOW, DOUBLE_SIGNAL_WINDOW_OPTIONS };

export class DoubleSignalService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async compute(windowDays: DoubleSignalWindowDays): Promise<DoubleSignalPayload> {
    return computeDoubleSignals(windowDays, this.pool);
  }

  async getPayload(windowDays: DoubleSignalWindowDays = DEFAULT_DOUBLE_SIGNAL_WINDOW): Promise<DoubleSignalPayload> {
    return getOrComputeDoubleSignal(windowDays, () => this.compute(windowDays));
  }

  async getDetail(
    ticker: string,
    windowDays: DoubleSignalWindowDays = DEFAULT_DOUBLE_SIGNAL_WINDOW
  ): Promise<DoubleSignalDetailPayload | null> {
    return computeDoubleSignalDetail(ticker, windowDays, this.pool);
  }
}

let defaultService: DoubleSignalService | null = null;

export function getDoubleSignalService(): DoubleSignalService {
  if (!defaultService) defaultService = new DoubleSignalService();
  return defaultService;
}

export { getCachedDoubleSignal };
