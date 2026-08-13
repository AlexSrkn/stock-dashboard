/**
 * Format a signed USD amount for activity / ownership value-change cells.
 *
 * Input must be raw US dollars. Institution Activity `valueChangeUsd` /
 * `currentValueUsd` / `previousValueUsd` are dollars after `filingValueUsd`
 * (sec_holding.value is already USD in this database).
 */
export function formatSignedUsdCompact(usd) {
  if (usd == null || usd === "") return "—";
  const x = Number(usd);
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "$0";

  const sign = x > 0 ? "+" : "−";
  const abs = Math.abs(x);

  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Format a value already expressed in USD millions (e.g. 2646.53 = $2,646.53M).
 * Prefer {@link formatSignedUsdCompact} when the pipeline provides raw dollars.
 */
export function formatUsdMillionsCompact(millions) {
  if (millions == null || millions === "") return "—";
  const x = Number(millions);
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "$0";

  const sign = x > 0 ? "+" : "−";
  const abs = Math.abs(x);

  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}B`;
  return `${sign}$${abs.toFixed(2)}M`;
}
