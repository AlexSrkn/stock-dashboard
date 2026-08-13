import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { formatSecCik } from "../../sec/http.js";
import { runInstitutionPerformanceEngine } from "./performanceEngine.js";
import { loadInstitutionHoldings } from "./holdingsLoader.js";
import {
  getCachedPerformanceSummaries,
  getOrComputePerformanceSummaries,
} from "./cache.js";
import {
  buildInstitutionRankings,
  parsePerformancePeriod,
  type InstitutionRankingInput,
  type InstitutionRankingsResult,
  type PerformancePeriod,
} from "./rankings.js";
import { getReturnsMatrix, requireReturnsMatrix, type ReturnsMatrix } from "./priceCache.js";
import type {
  InstitutionPerformanceOptions,
  InstitutionPerformanceSummary,
} from "./types.js";

export type { PerformancePeriod, InstitutionRankingsResult } from "./rankings.js";
export { parsePerformancePeriod } from "./rankings.js";
export { loadInstitutionHoldings } from "./holdingsLoader.js";

export interface InstitutionPerformanceServiceOptions extends InstitutionPerformanceOptions {
  /** Subset of tracked filer CIKs; default = all tracked institutions. */
  institutionIds?: string[];
  /** Inject a precomputed returns matrix (tests only). */
  returnsMatrix?: ReturnsMatrix;
  /** Limit 13F holdings load to the latest N quarters (bulk jobs). */
  maxLoadQuarters?: number;
}

export class InstitutionPerformanceService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async loadHoldings(
    institutionIds?: string[],
    options: Pick<InstitutionPerformanceServiceOptions, "maxLoadQuarters"> = {}
  ): Promise<Awaited<ReturnType<typeof loadInstitutionHoldings>>> {
    return loadInstitutionHoldings(this.pool, institutionIds, {
      maxQuarters: options.maxLoadQuarters,
    });
  }

  computePerformanceSync(
    holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>,
    options: InstitutionPerformanceServiceOptions = {}
  ): InstitutionPerformanceSummary[] {
    if (!holdings.length) return [];

    const matrix = options.returnsMatrix ?? requireReturnsMatrix();
    const result = runInstitutionPerformanceEngine({
      holdings,
      returnsMatrix: matrix,
      options,
    });
    return result.summaries;
  }

  async computePerformance(
    options: InstitutionPerformanceServiceOptions = {}
  ): Promise<InstitutionPerformanceSummary[]> {
    const holdings = await this.loadHoldings(options.institutionIds, options);
    return this.computePerformanceSync(holdings, options);
  }

  async getAllPerformanceSummaries(
    options: InstitutionPerformanceServiceOptions = {}
  ): Promise<InstitutionPerformanceSummary[]> {
    if (options.institutionIds?.length || options.returnsMatrix) {
      return this.computePerformance(options);
    }
    if (!getReturnsMatrix()) {
      const cached = getCachedPerformanceSummaries();
      if (cached) return cached;
      throw new Error(
        "Performance returns cache not ready. Run: npm run performance:warm-cache"
      );
    }
    return getOrComputePerformanceSummaries(() => this.computePerformance(options));
  }

  async getRankings(
    period: PerformancePeriod,
    institutions: InstitutionRankingInput[],
    options: InstitutionPerformanceServiceOptions = {}
  ): Promise<InstitutionRankingsResult & { computedAt: string }> {
    const summaries = await this.getAllPerformanceSummaries(options);
    const result = buildInstitutionRankings(summaries, institutions, period);
    return { ...result, computedAt: new Date().toISOString() };
  }

  async getPerformanceSeries(
    institutionId: string,
    options: InstitutionPerformanceServiceOptions = {}
  ): Promise<InstitutionPerformanceSummary[]> {
    if (options.institutionIds?.length || options.returnsMatrix) {
      return this.computePerformanceForInstitution(institutionId, options);
    }
    const all = await this.getAllPerformanceSummaries(options);
    const cik = formatSecCik(institutionId);
    return all
      .filter((r) => r.institutionId === cik)
      .sort((a, b) => a.quarter.localeCompare(b.quarter));
  }

  async computePerformanceForInstitution(
    institutionId: string,
    options: InstitutionPerformanceServiceOptions = {}
  ): Promise<InstitutionPerformanceSummary[]> {
    return this.computePerformance({
      ...options,
      institutionIds: [formatSecCik(institutionId)],
    });
  }
}

let defaultService: InstitutionPerformanceService | null = null;

export function getInstitutionPerformanceService(): InstitutionPerformanceService {
  if (!defaultService) defaultService = new InstitutionPerformanceService();
  return defaultService;
}
