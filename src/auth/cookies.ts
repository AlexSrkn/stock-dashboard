import type http from "node:http";

export const SESSION_COOKIE_NAME = "ta_session";

const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function getSessionTokenFromRequest(req: http.IncomingMessage): string | null {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  return token && token.length >= 16 ? token : null;
}

function cookieSecureFlag(): boolean {
  // Force Secure in production; allow override for local HTTPS tunnels.
  if (process.env.AUTH_COOKIE_SECURE === "1") return true;
  if (process.env.AUTH_COOKIE_SECURE === "0") return false;
  return process.env.NODE_ENV === "production";
}

export function buildSessionCookie(token: string, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`,
  ];
  if (cookieSecureFlag()) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (cookieSecureFlag()) parts.push("Secure");
  return parts.join("; ");
}

export function sessionMaxAgeSeconds(): number {
  const raw = Number(process.env.AUTH_SESSION_DAYS || "30");
  const days = Number.isFinite(raw) && raw > 0 ? raw : 30;
  return Math.floor(days * 24 * 60 * 60);
}
