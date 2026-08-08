import { secFetchJson } from "../sec/http.js";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

let issuerToTickerCache: Map<string, string> | null = null;

/** Normalize issuer / company titles for loose equality (drop suffixes, OF, punctuation). */
export function normalizeIssuerKey(name: string): string {
  return String(name || "")
    .toUpperCase()
    .replace(/-/g, " ")
    .replace(/,?\s+(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|PLC|LP|SA|AG|NV|SE)\.?/g, " ")
    .replace(/\s+COM(?:MON)?(?:\s+STOCK)?$/i, "")
    .replace(/\bOF\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadIssuerToTickerMap(): Promise<Map<string, string>> {
  if (issuerToTickerCache) return issuerToTickerCache;

  const raw = await secFetchJson<Record<string, { ticker: string; title: string }>>(SEC_TICKERS_URL);
  const map = new Map<string, string>();

  for (const row of Object.values(raw)) {
    if (!row?.ticker || !row?.title) continue;
    const sym = String(row.ticker).trim().toUpperCase();
    const key = normalizeIssuerKey(row.title);
    if (!key || map.has(key)) continue;
    map.set(key, sym);
  }

  issuerToTickerCache = map;
  return map;
}

function lookupTicker(issuer: string, map: Map<string, string>): string | null {
  const key = normalizeIssuerKey(issuer);
  if (!key) return null;

  if (map.has(key)) return map.get(key)!;

  const parts = key.split(" ").filter(Boolean);
  for (let n = parts.length; n >= 1; n--) {
    const sub = parts.slice(0, n).join(" ");
    if (map.has(sub)) return map.get(sub)!;
  }

  for (const [titleKey, sym] of map) {
    if (titleKey.length >= 4 && (key.includes(titleKey) || titleKey.includes(key))) {
      return sym;
    }
  }

  return null;
}

export async function resolveTickerFromIssuer(issuer: string): Promise<string | null> {
  const map = await loadIssuerToTickerMap();
  return lookupTicker(issuer, map);
}

export async function enrichRowsWithTickers<T extends { ticker: string | null; issuer: string }>(
  rows: T[]
): Promise<T[]> {
  if (!rows.length) return rows;
  const map = await loadIssuerToTickerMap();
  return rows.map((row) => {
    const existing = row.ticker ? String(row.ticker).trim().toUpperCase() : "";
    if (existing) return { ...row, ticker: existing };
    const resolved = lookupTicker(row.issuer, map);
    return { ...row, ticker: resolved };
  });
}
