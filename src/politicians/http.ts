const DEFAULT_UA =
  "Tradepile Research (congressional-disclosures; contact@tradepile.local)";

export function politicianUserAgent(): string {
  const fromEnv = (process.env.POLITICIAN_USER_AGENT || process.env.SEC_USER_AGENT || "").trim();
  return fromEnv || DEFAULT_UA;
}

/** Optional HTTP(S) proxy for politician scrapes (Senate eFD often blocks datacenter IPs). */
export function politicianProxyUrl(): string | null {
  const raw = (
    process.env.POLITICIAN_HTTP_PROXY ||
    process.env.SENATE_EFD_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ""
  ).trim();
  return raw || null;
}

type FetchInit = RequestInit & { dispatcher?: unknown };

let proxyDispatcher: unknown | null | undefined;

async function getProxyDispatcher(): Promise<unknown | null> {
  if (proxyDispatcher !== undefined) return proxyDispatcher;
  const proxyUrl = politicianProxyUrl();
  if (!proxyUrl) {
    proxyDispatcher = null;
    return null;
  }
  try {
    const undici = await import("undici");
    proxyDispatcher = new undici.ProxyAgent(proxyUrl);
    return proxyDispatcher;
  } catch (err) {
    throw new Error(
      `POLITICIAN_HTTP_PROXY is set but undici ProxyAgent failed to load: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export async function politicianFetch(
  url: string,
  init: RequestInit = {},
  { delayMs = 400 }: { delayMs?: number } = {}
): Promise<Response> {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", politicianUserAgent());
  if (!headers.has("Accept")) headers.set("Accept", "*/*");

  const dispatcher = await getProxyDispatcher();
  const opts: FetchInit = { ...init, headers };
  if (dispatcher) opts.dispatcher = dispatcher;
  return fetch(url, opts as RequestInit);
}

export async function politicianFetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await politicianFetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function politicianFetchBuffer(url: string, init?: RequestInit): Promise<Buffer> {
  const res = await politicianFetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
