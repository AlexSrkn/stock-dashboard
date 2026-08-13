/**
 * Shares outstanding fallback — Yahoo removed.
 * Prefer ownership_cache / SEC financial periods; callers should treat null as unknown.
 */
export async function fetchImpliedSharesOutstanding(_symbol: string): Promise<number | null> {
  return null;
}
