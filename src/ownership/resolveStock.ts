import type pg from "pg";
import { secFetchJson } from "../sec/http.js";
import { normalizeCusip } from "../sec/thirteenF/normalizeHoldings.js";
import {
  SELECT_PRIMARY_CUSIP_BY_HOLDINGS_SQL,
  SELECT_PRIMARY_CUSIP_BY_TOP_HOLDERS_SQL,
  SELECT_DISTINCT_CUSIPS_BY_ISSUER_SQL,
} from "./queries.js";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

let tickerTitleCache: Map<string, string> | null = null;

const resolvedTickerCache = new Map<string, ResolvedStock>();

async function loadTickerTitles(): Promise<Map<string, string>> {
  if (tickerTitleCache) return tickerTitleCache;
  const raw = await secFetchJson<Record<string, { ticker: string; title: string }>>(SEC_TICKERS_URL);
  const map = new Map<string, string>();
  for (const row of Object.values(raw)) {
    if (row?.ticker && row.title) {
      map.set(String(row.ticker).toUpperCase(), String(row.title));
    }
  }
  tickerTitleCache = map;
  return map;
}

/** Build a loose ILIKE pattern from SEC company title (e.g. "Apple Inc." → "%APPLE%"). */
export function issuerPatternFromTitle(title: string): string {
  const cleaned = title.replace(/,?\s+Inc\.?$/i, "").replace(/,?\s+Corp\.?$/i, "").trim();
  const token = cleaned.split(/\s+/)[0] || cleaned;
  return `%${token.toUpperCase()}%`;
}

async function resolveCusipsFromIssuerPattern(
  pool: pg.Pool,
  sym: string,
  issuerPattern: string,
  issuerHint: string | null
): Promise<ResolvedStock | null> {
  const res = await pool.query<{ cusip: string; issuer: string }>(
    SELECT_DISTINCT_CUSIPS_BY_ISSUER_SQL,
    [issuerPattern]
  );

  const cusips = [
    ...new Set(
      res.rows
        .map((r) => normalizeCusip(String(r.cusip).trim()))
        .filter((c) => c.length > 0)
    ),
  ];
  if (!cusips.length) return null;

  let resolvedCusips = cusips;
  if (cusips.length > 1) {
    const primary = await pool.query<{ cusip: string }>(SELECT_PRIMARY_CUSIP_BY_HOLDINGS_SQL, [
      cusips,
    ]);
    const top = primary.rows[0]?.cusip;
    if (top) {
      resolvedCusips = [normalizeCusip(String(top))];
    }
  }

  return {
    ticker: sym,
    cusips: resolvedCusips,
    issuerHint: res.rows[0]?.issuer ?? issuerHint ?? sym,
  };
}

async function resolveFromOwnershipCache(pool: pg.Pool, sym: string): Promise<ResolvedStock | null> {
  const cacheRes = await pool.query<{ primary_cusip: string | null; company_name: string | null }>(
    `SELECT oc.primary_cusip, s.company_name
     FROM ownership_cache oc
     LEFT JOIN stocks s ON s.ticker = oc.ticker
     WHERE oc.ticker = UPPER(BTRIM($1::text))
     LIMIT 1`,
    [sym]
  );
  const row = cacheRes.rows[0];
  if (!row) return null;

  const stored = row.primary_cusip ? normalizeCusip(String(row.primary_cusip).trim()) : "";
  if (stored) {
    return {
      ticker: sym,
      cusips: [stored],
      issuerHint: row.company_name ?? sym,
    };
  }

  const topHolder = await pool.query<{ cusip: string; issuer: string }>(
    SELECT_PRIMARY_CUSIP_BY_TOP_HOLDERS_SQL,
    [sym]
  );
  const matched = topHolder.rows[0];
  if (matched?.cusip) {
    const cusip = normalizeCusip(String(matched.cusip).trim());
    if (cusip) {
      void pool.query(`UPDATE ownership_cache SET primary_cusip = $2 WHERE ticker = $1`, [sym, cusip]);
      return {
        ticker: sym,
        cusips: [cusip],
        issuerHint: matched.issuer ?? row.company_name ?? sym,
      };
    }
  }

  if (row.company_name) {
    return resolveCusipsFromIssuerPattern(
      pool,
      sym,
      issuerPatternFromTitle(row.company_name),
      row.company_name
    );
  }

  const titles = await loadTickerTitles();
  const title = titles.get(sym);
  if (title) {
    return resolveCusipsFromIssuerPattern(pool, sym, issuerPatternFromTitle(title), title);
  }

  return null;
}

export interface ResolvedStock {
  ticker: string;
  cusips: string[];
  issuerHint: string | null;
}

export async function resolveStockIdentifiers(
  pool: pg.Pool,
  ticker: string
): Promise<ResolvedStock> {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) throw new OwnershipResolveError("Missing ticker", 400);

  const cached = resolvedTickerCache.get(sym);
  if (cached) return cached;

  const fromCache = await resolveFromOwnershipCache(pool, sym);
  if (fromCache) {
    resolvedTickerCache.set(sym, fromCache);
    return fromCache;
  }

  const titles = await loadTickerTitles();
  const title = titles.get(sym) ?? null;
  const issuerPattern = title ? issuerPatternFromTitle(title) : `%${sym}%`;

  const res = await pool.query<{ cusip: string; issuer: string }>(
    SELECT_DISTINCT_CUSIPS_BY_ISSUER_SQL,
    [issuerPattern]
  );

  const cusips = [
    ...new Set(
      res.rows
        .map((r) => normalizeCusip(String(r.cusip).trim()))
        .filter((c) => c.length > 0)
    ),
  ];
  if (!cusips.length) {
    throw new OwnershipResolveError(
      `No 13F holdings found for ticker ${sym}. Ingest manager filings or check symbol.`,
      404
    );
  }

  let resolvedCusips = cusips;
  if (cusips.length > 1) {
    const primary = await pool.query<{ cusip: string }>(SELECT_PRIMARY_CUSIP_BY_HOLDINGS_SQL, [
      cusips,
    ]);
    const top = primary.rows[0]?.cusip;
    if (top) {
      resolvedCusips = [normalizeCusip(String(top))];
    }
  }

  const issuerHint = res.rows[0]?.issuer ?? title;
  const resolved: ResolvedStock = { ticker: sym, cusips: resolvedCusips, issuerHint };
  resolvedTickerCache.set(sym, resolved);
  return resolved;
}

export class OwnershipResolveError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OwnershipResolveError";
    this.statusCode = statusCode;
  }
}
