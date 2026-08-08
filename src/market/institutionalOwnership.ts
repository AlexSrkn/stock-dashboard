import { getYahooFinance } from "./yahooClient.js";

const CACHE_MS = 15 * 60 * 1000;

function yahooNum(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "raw" in value) {
    const raw = (value as { raw: unknown }).raw;
    return raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const cache = new Map<string, { loadedAt: number; value: number | null }>();

/** Yahoo `defaultKeyStatistics.heldPercentInstitutions` (0–1 ratio). */
export async function fetchInstitutionalOwnership(symbol: string): Promise<number | null> {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.loadedAt < CACHE_MS) {
    return hit.value;
  }

  const data = await getYahooFinance().quoteSummary(sym, {
    modules: ["defaultKeyStatistics"],
  });
  const value = yahooNum(data.defaultKeyStatistics?.heldPercentInstitutions);
  cache.set(sym, { loadedAt: Date.now(), value });
  return value;
}
