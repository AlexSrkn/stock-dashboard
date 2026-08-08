import type pg from "pg";
import { getPool } from "../db/pool.js";
import {
  getCachedInstitutionalAccumulation,
  setInstitutionalAccumulationMemoryCache,
} from "./institutionalAccumulationCache.js";
import { computeInstitutionalShareAccumulation } from "./institutionalAccumulationCompute.js";
import type { InstitutionalAccumulationPayload } from "./institutionalAccumulationTypes.js";

export type {
  InstitutionalAccumulationPayload,
  InstitutionalAccumulationRow,
} from "./institutionalAccumulationTypes.js";

let inflight: Promise<InstitutionalAccumulationPayload> | null = null;

export async function loadInstitutionalShareAccumulation(
  _pool: pg.Pool = getPool(),
  limit = 100
): Promise<InstitutionalAccumulationPayload> {
  const cached = getCachedInstitutionalAccumulation(limit);
  if (cached) return cached;

  if (!inflight) {
    inflight = computeInstitutionalShareAccumulation(_pool)
      .then((payload) => {
        setInstitutionalAccumulationMemoryCache(payload);
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }

  const payload = await inflight;
  return {
    ...payload,
    count: Math.min(limit, payload.stocks.length),
    stocks: payload.stocks.slice(0, limit),
  };
}
