import { SecHttpError } from "./http.js";

export interface RetryOptions {
  /** Total attempts including the first try. Default 3. */
  maxAttempts?: number;
  /** Initial delay before retry (ms). Default 400. */
  delayMs?: number;
  /** Multiply delay by this factor each retry. Default 2. */
  backoffFactor?: number;
  /** Cap delay between retries (ms). Default 8000. */
  maxDelayMs?: number;
  /** Optional hook for logging/metrics. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const DEFAULT_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function isRetryableError(err: unknown, retryableStatus = DEFAULT_RETRYABLE_STATUS): boolean {
  if (err instanceof SecHttpError) {
    return retryableStatus.has(err.statusCode);
  }
  if (err instanceof TypeError) return true;
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND";
  }
  return false;
}

function retryDelay(attempt: number, base: number, factor: number, cap: number): number {
  const ms = base * factor ** (attempt - 1);
  return Math.min(ms, cap);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async function with exponential backoff retries on transient failures.
 * 429/503 get a longer initial delay — SEC often rate-limits datacenter IPs harder.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const delayMs = options.delayMs ?? 400;
  const backoffFactor = options.backoffFactor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 20000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const canRetry = attempt < maxAttempts && isRetryableError(err);
      if (!canRetry) break;

      let wait = retryDelay(attempt, delayMs, backoffFactor, maxDelayMs);
      if (err instanceof SecHttpError && (err.statusCode === 503 || err.statusCode === 429)) {
        // SEC fair-access / overload: give the IP a longer cool-down than generic retries.
        wait = Math.max(wait, 2000 * attempt);
        wait = Math.min(wait, 30000);
      }
      options.onRetry?.({ attempt, delayMs: wait, error: err });
      await sleep(wait);
    }
  }

  throw lastError;
}
