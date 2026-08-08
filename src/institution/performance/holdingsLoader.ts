import type pg from "pg";
import { enrichRowsWithTickers } from "../resolveTicker.js";
import { formatSecCik } from "../../sec/http.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../../ownership/trackedInstitutions.js";
import { SELECT_INSTITUTION_HOLDINGS_BATCH_SQL } from "./queries.js";
import type { InstitutionHolding } from "./types.js";

interface HoldingRow {
  institution_id: string;
  quarter: string;
  ticker: string | null;
  issuer: string | null;
  cusip: string | null;
  shares: number;
  market_value: number;
}

function aggregateHoldingsByTicker(rows: InstitutionHolding[]): InstitutionHolding[] {
  const byKey = new Map<string, InstitutionHolding>();
  for (const row of rows) {
    const key = `${row.institutionId}::${row.quarter}::${row.ticker}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...row });
      continue;
    }
    prev.marketValue += row.marketValue;
    if (row.shares != null) {
      prev.shares = (prev.shares ?? 0) + row.shares;
    }
  }
  return [...byKey.values()];
}

export async function loadInstitutionHoldings(
  pool: pg.Pool,
  institutionIds?: string[]
): Promise<InstitutionHolding[]> {
  const ciks = (institutionIds?.length ? institutionIds : [...TRACKED_INSTITUTIONAL_CIK_PADDED]).map(
    (c) => formatSecCik(c)
  );

  const res = await pool.query<HoldingRow>(SELECT_INSTITUTION_HOLDINGS_BATCH_SQL, [ciks]);
  const raw = res.rows.map((row) => ({
    institutionId: String(row.institution_id),
    quarter: String(row.quarter),
    ticker: row.ticker ? String(row.ticker).trim().toUpperCase() : null,
    issuer: String(row.issuer || ""),
    cusip: row.cusip,
    shares: row.shares != null ? Number(row.shares) : null,
    marketValue: Number(row.market_value),
  }));

  const enriched = await enrichRowsWithTickers(
    raw.map((row) => ({
      ticker: row.ticker,
      issuer: row.issuer,
    }))
  );

  const holdings: InstitutionHolding[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const ticker = enriched[i]?.ticker ? String(enriched[i].ticker).trim().toUpperCase() : "";
    const mv = row.marketValue;
    if (!ticker || !Number.isFinite(mv) || mv <= 0) continue;
    holdings.push({
      institutionId: row.institutionId,
      quarter: row.quarter,
      ticker,
      marketValue: mv,
      shares: row.shares,
      cusip: row.cusip,
    });
  }

  return aggregateHoldingsByTicker(holdings);
}
