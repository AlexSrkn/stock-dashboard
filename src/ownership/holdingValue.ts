/**
 * sec_holding.value is stored as USD dollars in this database (despite the
 * historical value_usd_thousands column name). Do not multiply by 1,000.
 */
export function filingValueUsd(valueFromDb: number | null | undefined): number | null {
  const x = Number(valueFromDb);
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.round(x * 100) / 100;
}

function liveMarkUsd(shares: number, stockPrice: number | null): number | null {
  if (!stockPrice || stockPrice <= 0) return null;
  if (!Number.isFinite(shares)) return null;
  return Math.round(shares * stockPrice * 100) / 100;
}

/**
 * Position value: 13F reported market value, with live mark as fallback
 * when a filing value is missing.
 */
export function resolvePositionValueUsd(
  shares: number,
  filingValueFromDb: number | null | undefined,
  stockPrice: number | null
): number | null {
  return filingValueUsd(filingValueFromDb) ?? liveMarkUsd(shares, stockPrice);
}
