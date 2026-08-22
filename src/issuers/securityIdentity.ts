import type pg from "pg";
import { getPool } from "../db/pool.js";
import { normalizeCusip } from "../sec/thirteenF/normalizeHoldings.js";
import { getIssuerRepository } from "./repository.js";
import type { CanonicalIssuer, ReportedSecurityIdentity } from "./types.js";

/** Map a 13F-reported CUSIP to its specific security + canonical issuer (no holding merge). */
export async function resolveReportedSecurityIdentity(
  cusip: string,
  pool: pg.Pool = getPool()
): Promise<ReportedSecurityIdentity> {
  const normalized = normalizeCusip(String(cusip || "").trim());
  const repo = getIssuerRepository();
  const mapped = await repo.getCusipMapping(normalized);

  if (mapped) {
    const issuer = await repo.getIssuerById(mapped.issuerId);
    return {
      cusip: normalized,
      reportedTicker: mapped.ticker,
      canonicalIssuer: issuer,
    };
  }

  return { cusip: normalized, reportedTicker: null, canonicalIssuer: null };
}

/** Learn CUSIP → security mapping from a 13F line without merging positions. */
export async function registerCusipForSecurity(input: {
  cusip: string;
  ticker: string;
  issuerId: number;
  issuerNameHint?: string | null;
}): Promise<void> {
  await getIssuerRepository().upsertCusipMapping({
    cusip: normalizeCusip(input.cusip),
    ticker: input.ticker.toUpperCase(),
    issuerId: input.issuerId,
    issuerNameHint: input.issuerNameHint ?? null,
  });
}

export function attachCanonicalIssuerToMeta<T extends Record<string, unknown>>(
  row: T,
  identity: ReportedSecurityIdentity
): T & {
  reportedCusip: string;
  reportedTicker: string | null;
  canonicalIssuer: CanonicalIssuer | null;
} {
  return {
    ...row,
    reportedCusip: identity.cusip,
    reportedTicker: identity.reportedTicker,
    canonicalIssuer: identity.canonicalIssuer,
  };
}
