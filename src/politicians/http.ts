const DEFAULT_UA =
  "Tradepile Research (congressional-disclosures; contact@tradepile.local)";

export function politicianUserAgent(): string {
  const fromEnv = (process.env.POLITICIAN_USER_AGENT || process.env.SEC_USER_AGENT || "").trim();
  return fromEnv || DEFAULT_UA;
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
  return fetch(url, { ...init, headers });
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
