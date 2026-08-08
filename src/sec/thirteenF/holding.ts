import {
  normalizeHoldings,
  normalizeHoldingsFromFiling,
  toHoldings as mapNormalizedToHoldings,
  toQuarter,
} from "./normalizeHoldings.js";
import type { Parsed13FHolding } from "./parse13F.js";
import type { Holding, Sec13FFilingRef } from "./types.js";

export { toQuarter };

export interface ToHoldingsContext {
  fundName: string | null;
  filingDate: string;
  reportPeriod?: string | null;
  filerCik?: string;
  accessionNumber?: string;
}

/**
 * Map parsed 13F XML rows plus filing context into {@link Holding} records.
 */
export function toHoldings(
  parsed: Parsed13FHolding[],
  context: ToHoldingsContext
): Holding[] {
  const records = normalizeHoldings(parsed, {
    fundName: context.fundName,
    filerCik: context.filerCik ?? "0000000000",
    accessionNumber: context.accessionNumber ?? "",
    filingDate: context.filingDate,
    reportPeriod: context.reportPeriod,
  });
  return mapNormalizedToHoldings(records);
}

/**
 * Build {@link Holding} array from a filing reference and parsed rows.
 */
export function holdingsFromFiling(
  filing: Sec13FFilingRef,
  parsed: Parsed13FHolding[]
): Holding[] {
  return mapNormalizedToHoldings(normalizeHoldingsFromFiling(filing, parsed));
}
