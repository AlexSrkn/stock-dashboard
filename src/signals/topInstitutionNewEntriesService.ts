import type pg from "pg";
import { getPool } from "../db/pool.js";
import { computeTopInstitutionNewEntries } from "./topInstitutionNewEntries.js";
import {
  getCachedTopInstitutionNewEntries,
  getOrComputeTopInstitutionNewEntries,
} from "./topInstitutionNewEntriesCache.js";
import type { TopInstitutionNewEntriesPayload } from "./topInstitutionNewEntries.js";

export class TopInstitutionNewEntriesService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async compute(): Promise<TopInstitutionNewEntriesPayload> {
    return computeTopInstitutionNewEntries(this.pool);
  }

  async getPayload(): Promise<TopInstitutionNewEntriesPayload> {
    return getOrComputeTopInstitutionNewEntries(() => this.compute());
  }
}

let defaultService: TopInstitutionNewEntriesService | null = null;

export function getTopInstitutionNewEntriesService(): TopInstitutionNewEntriesService {
  if (!defaultService) defaultService = new TopInstitutionNewEntriesService();
  return defaultService;
}

export { getCachedTopInstitutionNewEntries };
