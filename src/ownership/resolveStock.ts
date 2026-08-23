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

const ENTITY_SUFFIX_RE =
  /,?\s+(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|PLC|LLC|LP|SA|AG|NV|SE)\.?$/i;

/**
 * Build an ILIKE pattern from an SEC company title.
 * Prefer two significant tokens when available so short names like "RIO"
 * do not match unrelated issuers (e.g. Aeroportuario, Marriott).
 * "RIO TINTO PLC" → "%RIO TINTO%", "Apple Inc." → "%APPLE%".
 */
export function issuerPatternFromTitle(title: string): string {
  const cleaned = String(title || "")
    .replace(ENTITY_SUFFIX_RE, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    return `%${tokens[0]!.toUpperCase()} ${tokens[1]!.toUpperCase()}%`;
  }
  return `%${(tokens[0] || cleaned || title).toUpperCase()}%`;
}

/** Reject padded / placeholder CUSIPs (000000000, 000000RIO, etc.). */
export function isUsableCusip(cusip: string): boolean {
  const c = normalizeCusip(cusip);
  if (!c || c.length < 6) return false;
  if (/^0+$/.test(c)) return false;
  if (/^0+[A-Z]/.test(c)) return false;
  return true;
}

async function pickPrimaryCusip(
  pool: pg.Pool,
  cusips: string[],
  issuerPattern: string
): Promise<string | null> {
  if (!cusips.length) return null;
  if (cusips.length === 1) return cusips[0]!;
  const primary = await pool.query<{ cusip: string }>(SELECT_PRIMARY_CUSIP_BY_HOLDINGS_SQL, [
    cusips,
    issuerPattern,
  ]);
  const top = primary.rows[0]?.cusip;
  if (top && isUsableCusip(String(top))) return normalizeCusip(String(top));
  // Distinct query is ordered by issuer-matched shares — first usable wins.
  return cusips[0] ?? null;
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
        .filter((c) => isUsableCusip(c))
    ),
  ];
  if (!cusips.length) return null;

  const primary = await pickPrimaryCusip(pool, cusips, issuerPattern);
  const resolvedCusips = primary ? [primary] : cusips.slice(0, 1);

  const hintRow =
    res.rows.find((r) => normalizeCusip(String(r.cusip)) === resolvedCusips[0]) ??
    res.rows.find((r) => isUsableCusip(String(r.cusip))) ??
    res.rows[0];

  return {
    ticker: sym,
    cusips: resolvedCusips,
    issuerHint: hintRow?.issuer ?? issuerHint ?? sym,
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
  if (stored && isUsableCusip(stored)) {
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
    if (isUsableCusip(cusip)) {
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

  const resolved = await resolveCusipsFromIssuerPattern(pool, sym, issuerPattern, title);
  if (!resolved) {
    throw new OwnershipResolveError(
      `No 13F holdings found for ticker ${sym}. Ingest manager filings or check symbol.`,
      404
    );
  }

  resolvedTickerCache.set(sym, resolved);
  return resolved;
}

/** Clear in-process resolution cache (tests / after ownership rebuild). */
export function clearResolvedStockCache(): void {
  resolvedTickerCache.clear();
}

export class OwnershipResolveError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OwnershipResolveError";
    this.statusCode = statusCode;
  }
}
