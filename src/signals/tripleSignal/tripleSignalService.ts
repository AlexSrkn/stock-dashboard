import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { computeTripleSignalDetail, computeTripleSignals } from "./compute.js";
import { getCachedTripleSignal, getOrComputeTripleSignal } from "./cache.js";
import type {
  TripleSignalDetailPayload,
  TripleSignalPayload,
  TripleSignalWindowDays,
} from "./types.js";
import { DEFAULT_TRIPLE_SIGNAL_WINDOW, TRIPLE_SIGNAL_WINDOW_OPTIONS } from "./types.js";

export function parseTripleSignalWindowDays(raw: string | null | undefined): TripleSignalWindowDays {
  const n = Number(raw);
  if (n === 90 || n === 180 || n === 365) return n;
  return DEFAULT_TRIPLE_SIGNAL_WINDOW;
}

export { DEFAULT_TRIPLE_SIGNAL_WINDOW, TRIPLE_SIGNAL_WINDOW_OPTIONS };

export class TripleSignalService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async compute(windowDays: TripleSignalWindowDays): Promise<TripleSignalPayload> {
    return computeTripleSignals(windowDays, this.pool);
  }

  async getPayload(
    windowDays: TripleSignalWindowDays = DEFAULT_TRIPLE_SIGNAL_WINDOW
  ): Promise<TripleSignalPayload> {
    return getOrComputeTripleSignal(windowDays, () => this.compute(windowDays));
  }

  async getDetail(
    ticker: string,
    windowDays: TripleSignalWindowDays = DEFAULT_TRIPLE_SIGNAL_WINDOW
  ): Promise<TripleSignalDetailPayload | null> {
    return computeTripleSignalDetail(ticker, windowDays, this.pool);
  }
}

let defaultService: TripleSignalService | null = null;

export function getTripleSignalService(): TripleSignalService {
  if (!defaultService) defaultService = new TripleSignalService();
  return defaultService;
}

export { getCachedTripleSignal };
