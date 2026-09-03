export const SEC_ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data";
export const SEC_DATA_BASE = "https://data.sec.gov";
export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

export const DEFAULT_SEC_USER_AGENT =
  "Tradepile/1.0 (set SEC_USER_AGENT in .env - see https://www.sec.gov/os/webmaster-faq#developers)";

export class SecHttpError extends Error {
  readonly statusCode: number;
  readonly url: string;

  constructor(message: string, statusCode: number, url: string) {
    super(message);
    this.name = "SecHttpError";
    this.statusCode = statusCode;
    this.url = url;
  }
}

export interface SecFetchOptions {
  userAgent?: string;
  accept?: string;
  fetch?: typeof globalThis.fetch;
}

/** HTTP headers must be visible ASCII only (Node/fetch reject Unicode in User-Agent). */
export function sanitizeSecUserAgent(
  value: string | undefined,
  fallback: string = DEFAULT_SEC_USER_AGENT
): string {
  const cleaned = String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n/g, " ")
    .replace(/[^\t\x20-\x7E]/g, "")
    .trim();
  return cleaned || fallback;
}

export function resolveSecUserAgent(explicit?: string): string {
  return sanitizeSecUserAgent(explicit ?? process.env.SEC_USER_AGENT);
}

export function formatSecCik(cik: number | string): string {
  const digits = String(cik).replace(/\D/g, "");
  if (!digits) throw new Error("Invalid CIK: empty value");
  return digits.padStart(10, "0");
}

export function accessionToArchivePath(accessionNumber: string): string {
  return String(accessionNumber).replace(/-/g, "");
}

export function edgarFilingBaseUrl(filerCik: number | string, accessionNumber: string): string {
  const cik = formatSecCik(filerCik).replace(/^0+/, "") || "0";
  const acc = accessionToArchivePath(accessionNumber);
  return `${SEC_ARCHIVES_BASE}/${cik}/${acc}`;
}

/** Filing detail index (lists primary HTML + info-table HTML/XSL links). */
export function edgarFilingIndexUrl(filerCik: number | string, accessionNumber: string): string {
  const acc = String(accessionNumber).trim();
  return `${edgarFilingBaseUrl(filerCik, accessionNumber)}/${acc}-index.htm`;
}

export async function secFetch(
  url: string,
  options: SecFetchOptions = {}
): Promise<Response> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error("fetch is not available; use Node 18+ or pass options.fetch");

  const userAgent = resolveSecUserAgent(options.userAgent);
  const res = await fetchFn(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: options.accept ?? "*/*",
    },
  });
  return res;
}

export async function secFetchText(url: string, options: SecFetchOptions = {}): Promise<string> {
  const res = await secFetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new SecHttpError(`SEC HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, url);
  }
  return text;
}

export async function secFetchJson<T>(url: string, options: SecFetchOptions = {}): Promise<T> {
  const text = await secFetchText(url, { ...options, accept: "application/json" });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SecHttpError("SEC response was not valid JSON", 200, url);
  }
}

/** SEC fair-access: stay under ~10 requests/second. Datacenter IPs often need slower. */
export function secThrottle(ms?: number): Promise<void> {
  const fromEnv = Number(process.env.SEC_THROTTLE_MS);
  const delay = Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : (ms ?? 250);
  return new Promise((resolve) => setTimeout(resolve, delay));
}
