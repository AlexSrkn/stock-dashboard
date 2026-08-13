/**
 * Presentation-only formatters for 13F portfolio proxy values.
 * Never use these strings as inputs to growth calculations.
 */

export function formatProxyUsd(n) {
  if (n == null || n === "") return "N/A";
  const x = Number(n);
  if (!Number.isFinite(x)) return "N/A";
  const abs = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

export function formatProxyHoldings(n) {
  if (n == null || n === "") return "N/A";
  const x = Number(n);
  if (!Number.isFinite(x)) return "N/A";
  return Math.round(x).toLocaleString("en-US");
}

export function formatProxyPct(n) {
  if (n == null || n === "") return "N/A";
  const x = Number(n);
  if (!Number.isFinite(x)) return "N/A";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}
