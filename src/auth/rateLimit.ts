/**
 * Best-effort in-memory sliding-window rate limits (per process).
 * Fine for a single VPS node; not shared across multi-instance deploys.
 */
import type http from "node:http";
import { AuthError } from "./types.js";

type Bucket = number[];

const buckets = new Map<string, Bucket>();

export function clientIp(req: http.IncomingMessage): string {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return xf || req.socket.remoteAddress || "unknown";
}

function prune(key: string, windowMs: number, now: number): number[] {
  const prev = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  buckets.set(key, prev);
  return prev;
}

/**
 * Record a hit. Throws AuthError(429) when over the limit.
 */
export function assertRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  message?: string;
}): void {
  const now = Date.now();
  const hits = prune(input.key, input.windowMs, now);
  if (hits.length >= input.limit) {
    const oldest = hits[0] ?? now;
    const retrySec = Math.max(1, Math.ceil((input.windowMs - (now - oldest)) / 1000));
    throw new AuthError(
      429,
      "rate_limited",
      input.message ||
        `Too many attempts. Please wait ${retrySec}s and try again.`
    );
  }
  hits.push(now);
  buckets.set(input.key, hits);
}

/** Occasional cleanup so idle keys don't linger forever. */
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) {
    const kept = hits.filter((t) => now - t < 60 * 60_000);
    if (!kept.length) buckets.delete(key);
    else buckets.set(key, kept);
  }
}, 15 * 60_000).unref?.();
