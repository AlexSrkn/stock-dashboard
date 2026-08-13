const DEFAULT_UA =
  "Tradepile Research (13f.info-managers; contact@tradepile.local)";

export function thirteenFInfoUserAgent(): string {
  const fromEnv = (
    process.env.THIRTEEN_F_INFO_USER_AGENT ||
    process.env.SEC_USER_AGENT ||
    ""
  ).trim();
  return fromEnv || DEFAULT_UA;
}

export class ThirteenFInfoHttpError extends Error {
  readonly statusCode: number;
  readonly url: string;

  constructor(statusCode: number, url: string, message?: string) {
    super(message || `HTTP ${statusCode} for ${url}`);
    this.name = "ThirteenFInfoHttpError";
    this.statusCode = statusCode;
    this.url = url;
  }
}

export async function thirteenFInfoFetch(
  url: string,
  init: RequestInit = {},
  { delayMs = 400 }: { delayMs?: number } = {}
): Promise<Response> {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", thirteenFInfoUserAgent());
  if (!headers.has("Accept")) headers.set("Accept", "text/html,application/xhtml+xml");
  return fetch(url, { ...init, headers });
}

export async function thirteenFInfoFetchText(
  url: string,
  {
    delayMs = 400,
    init,
  }: { delayMs?: number; init?: RequestInit } = {}
): Promise<string> {
  const res = await thirteenFInfoFetch(url, init, { delayMs });
  if (!res.ok) throw new ThirteenFInfoHttpError(res.status, url);
  return res.text();
}
