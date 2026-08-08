import {
  SEC_DATA_BASE,
  SEC_TICKERS_URL,
  SecHttpError,
  formatSecCik,
  resolveSecUserAgent,
  secFetchJson,
  secFetchText,
  type SecFetchOptions,
} from "./http.js";

const SEC_SUBMISSIONS_BASE = `${SEC_DATA_BASE}/submissions/`;

export interface SecFilingsRecent {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[];
  fileNumber: string[];
  filmNumber: string[];
  items: string[];
  size: number[];
  isXBRL: number[];
  isInlineXBRL: number[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

export interface SecFilingsFileRef {
  name: string;
  filingCount: number;
  filingFrom: string;
  filingTo: string;
}

export interface SecCompanySubmissions {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  ownerOrg?: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  ein?: string;
  description: string;
  website: string;
  investorWebsite?: string;
  category: string;
  fiscalYearEnd: string;
  stateOfIncorporation: string;
  stateOfIncorporationDescription: string;
  addresses: {
    mailing?: Record<string, string>;
    business?: Record<string, string>;
  };
  phone: string;
  flags: string;
  formerNames: Array<{ name: string; from: string; to: string }>;
  filings: {
    recent: SecFilingsRecent;
    files: SecFilingsFileRef[];
  };
  [key: string]: unknown;
}

export interface DownloadSecSubmissionsOptions extends SecFetchOptions {
  cik: number | string;
}

export interface DownloadSecSubmissionsByTickerOptions extends SecFetchOptions {
  ticker: string;
}

/** @deprecated Use SecHttpError */
export class SecSubmissionsError extends SecHttpError {
  constructor(message: string, statusCode: number, url: string) {
    super(message, statusCode, url);
    this.name = "SecSubmissionsError";
  }
}

export function secSubmissionsUrl(cik: number | string): string {
  return `${SEC_SUBMISSIONS_BASE}CIK${formatSecCik(cik)}.json`;
}

export async function downloadSecSubmissionsJson(
  options: DownloadSecSubmissionsOptions
): Promise<SecCompanySubmissions> {
  const url = secSubmissionsUrl(options.cik);
  const text = await secFetchText(url, options);
  let data: SecCompanySubmissions;
  try {
    data = JSON.parse(text) as SecCompanySubmissions;
  } catch {
    throw new SecHttpError("SEC submissions response was not valid JSON", 200, url);
  }
  if (!data?.cik || !data?.filings?.recent) {
    throw new SecHttpError("SEC submissions JSON missing expected fields", 200, url);
  }
  return data;
}

let tickerToCikCache: { loadedAt: number; map: Map<string, number> } | null = null;
const TICKER_CACHE_MS = 6 * 60 * 60 * 1000;

const SEC_TICKER_ALIASES: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BF.B": "BF-B",
};

export async function lookupCikFromTicker(
  ticker: string,
  options: SecFetchOptions = {}
): Promise<number> {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) throw new Error("Missing ticker");
  const lookupSym = SEC_TICKER_ALIASES[sym] || sym;

  const now = Date.now();
  if (!tickerToCikCache || now - tickerToCikCache.loadedAt > TICKER_CACHE_MS) {
    const raw = await secFetchJson<Record<string, { ticker: string; cik_str: number }>>(
      SEC_TICKERS_URL,
      options
    );
    const map = new Map<string, number>();
    for (const row of Object.values(raw)) {
      if (row?.ticker != null && row.cik_str != null) {
        map.set(String(row.ticker).toUpperCase(), Number(row.cik_str));
      }
    }
    tickerToCikCache = { loadedAt: now, map };
  }

  const cik = tickerToCikCache.map.get(lookupSym);
  if (cik == null) throw new Error(`Unknown ticker for SEC mapping: ${sym}`);
  return cik;
}

export async function downloadSecSubmissionsByTicker(
  options: DownloadSecSubmissionsByTickerOptions
): Promise<SecCompanySubmissions> {
  const cik = await lookupCikFromTicker(options.ticker, options);
  return downloadSecSubmissionsJson({ cik, ...options });
}

export interface SecCompanyTickerEntry {
  ticker: string;
  cik: number;
  title: string;
}

/** All issuers from SEC `company_tickers.json`, sorted by ticker. */
export async function loadAllSecCompanyTickers(
  options: SecFetchOptions = {}
): Promise<SecCompanyTickerEntry[]> {
  const raw = await secFetchJson<Record<string, { ticker: string; cik_str: number; title: string }>>(
    SEC_TICKERS_URL,
    options
  );
  const out: SecCompanyTickerEntry[] = [];
  for (const row of Object.values(raw)) {
    if (!row?.ticker || row.cik_str == null) continue;
    const ticker = String(row.ticker).trim().toUpperCase();
    if (!ticker) continue;
    out.push({
      ticker,
      cik: Number(row.cik_str),
      title: String(row.title ?? "").trim(),
    });
  }
  out.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return out;
}
