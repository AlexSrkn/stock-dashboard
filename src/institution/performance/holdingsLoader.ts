import type pg from "pg";
import { enrichRowsWithTickers } from "../resolveTicker.js";
import { formatSecCik } from "../../sec/http.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../../ownership/trackedInstitutions.js";
import {
  SELECT_INSTITUTION_HOLDINGS_BATCH_QUARTERS_SQL,
  SELECT_INSTITUTION_HOLDINGS_BATCH_SQL,
  SELECT_INSTITUTION_QUARTERS_BATCH_SQL,
} from "./queries.js";
import { sortQuarters } from "./quarters.js";
import type { InstitutionHolding } from "./types.js";

export interface LoadInstitutionHoldingsOptions {
  /** Keep only the latest N distinct 13F quarters (reduces memory for bulk signal jobs). */
  maxQuarters?: number;
  /** Explicit quarter list (takes precedence over maxQuarters). */
  quarters?: string[];
}

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
  institutionIds?: string[],
  options: LoadInstitutionHoldingsOptions = {}
): Promise<InstitutionHolding[]> {
  const ciks = (institutionIds?.length ? institutionIds : [...TRACKED_INSTITUTIONAL_CIK_PADDED]).map(
    (c) => formatSecCik(c)
  );

  let quarters: string[] | null = null;
  if (options.quarters?.length) {
    quarters = sortQuarters([...new Set(options.quarters.map(String))]);
    if (!quarters.length) return [];
  } else if (options.maxQuarters != null && options.maxQuarters > 0) {
    const qRes = await pool.query<{ quarter: string }>(SELECT_INSTITUTION_QUARTERS_BATCH_SQL, [ciks]);
    quarters = sortQuarters(qRes.rows.map((r) => String(r.quarter))).slice(-options.maxQuarters);
    if (!quarters.length) return [];
  }

  const sql = quarters != null ? SELECT_INSTITUTION_HOLDINGS_BATCH_QUARTERS_SQL : SELECT_INSTITUTION_HOLDINGS_BATCH_SQL;
  const params = quarters != null ? [ciks, quarters] : [ciks];
  const res = await pool.query<HoldingRow>(sql, params);
  const raw = res.rows.map((row) => ({
    institutionId: String(row.institution_id),
    quarter: String(row.quarter),
    ticker: row.ticker ? String(row.ticker).trim().toUpperCase() : null,
    issuer: String(row.issuer || ""),
    cusip: row.cusip,
    shares: row.shares != null ? Number(row.shares) : null,
    marketValue: Number(row.market_value),
  }));

  const missing: { ticker: string | null; issuer: string }[] = [];
  const missingAt: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!raw[i].ticker) {
      missingAt.push(i);
      missing.push({ ticker: null, issuer: raw[i].issuer });
    }
  }
  const resolvedMissing = missing.length ? await enrichRowsWithTickers(missing) : [];
  const resolvedByRawIndex = new Map<number, string>();
  for (let j = 0; j < missingAt.length; j++) {
    const t = resolvedMissing[j]?.ticker ? String(resolvedMissing[j].ticker).trim().toUpperCase() : "";
    if (t) resolvedByRawIndex.set(missingAt[j], t);
  }

  const holdings: InstitutionHolding[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const ticker = row.ticker || resolvedByRawIndex.get(i) || "";
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
