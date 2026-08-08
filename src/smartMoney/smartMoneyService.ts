import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadTickerRawSignals } from "./aggregate.js";
import { buildSmartMoneyScores } from "./compositeScore.js";
import {
  getCachedSmartMoneyScore,
  getOrComputeSmartMoneyScores,
} from "./cache.js";
import type { SmartMoneyScore, SmartMoneyScoresPayload } from "./types.js";

export class SmartMoneyService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async computeAllScores(): Promise<SmartMoneyScore[]> {
    const raw = await loadTickerRawSignals(this.pool);
    return buildSmartMoneyScores(raw);
  }

  async getAllScores(limit?: number): Promise<SmartMoneyScoresPayload> {
    const scores = await getOrComputeSmartMoneyScores(() => this.computeAllScores());
    const sliced = limit != null ? scores.slice(0, Math.max(1, limit)) : scores;
    return {
      computedAt: new Date().toISOString(),
      count: scores.length,
      scores: sliced,
    };
  }

  async getScoreForTicker(ticker: string): Promise<SmartMoneyScore | null> {
    const sym = String(ticker || "").trim().toUpperCase();
    if (!sym) return null;

    const cached = getCachedSmartMoneyScore(sym);
    if (cached) return cached;

    await getOrComputeSmartMoneyScores(() => this.computeAllScores());
    return getCachedSmartMoneyScore(sym);
  }
}

let defaultService: SmartMoneyService | null = null;

export function getSmartMoneyService(): SmartMoneyService {
  if (!defaultService) defaultService = new SmartMoneyService();
  return defaultService;
}
