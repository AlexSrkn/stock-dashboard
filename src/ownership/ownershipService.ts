import type pg from "pg";
import { getPool } from "../db/pool.js";
import type { OwnershipQueryOptions } from "./types.js";
import {
  getInstitutionalChartEvents,
  getInstitutionalOptions,
  getNewPositions,
  getOwnershipChanges,
  getSoldOut,
  getTopHolders,
} from "./ownershipAnalytics.js";

export type OwnershipEndpoint =
  | "top-holders"
  | "ownership-changes"
  | "new-positions"
  | "sold-out"
  | "institutional-options"
  | "institutional-transactions";

export class OwnershipService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async query(
    endpoint: OwnershipEndpoint,
    ticker: string,
    options: OwnershipQueryOptions = {}
  ) {
    switch (endpoint) {
      case "top-holders":
        return getTopHolders(this.pool, ticker, options);
      case "ownership-changes":
        return getOwnershipChanges(this.pool, ticker, options);
      case "new-positions":
        return getNewPositions(this.pool, ticker, options);
      case "sold-out":
        return getSoldOut(this.pool, ticker, options);
      case "institutional-options":
        return getInstitutionalOptions(this.pool, ticker, options);
      case "institutional-transactions":
        return getInstitutionalChartEvents(this.pool, ticker, options);
      default:
        throw new Error(`Unknown ownership endpoint: ${endpoint}`);
    }
  }
}

let defaultService: OwnershipService | null = null;

export function getOwnershipService(): OwnershipService {
  if (!defaultService) defaultService = new OwnershipService();
  return defaultService;
}
