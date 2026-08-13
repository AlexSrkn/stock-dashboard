/** Open-market Form 4 sides used for watchlist / Market Pulse buy-sell signals. */

export function isOpenMarketInsiderBuy(transactionCode: string | null | undefined): boolean {
  return String(transactionCode || "").trim().toUpperCase() === "P";
}

export function isOpenMarketInsiderSell(transactionCode: string | null | undefined): boolean {
  return String(transactionCode || "").trim().toUpperCase() === "S";
}

export function openMarketInsiderActionLabel(
  transactionCode: string | null | undefined,
  acquisitionDisposition: string | null | undefined = null
): string {
  const code = String(transactionCode || "").trim().toUpperCase();
  if (code === "P") return "Bought shares";
  if (code === "S") return "Sold shares";
  if (code === "A") return "Awarded shares";
  if (code === "M") return "Exercised options";
  if (code === "F") return "Shares withheld";
  if (code === "G") return "Gifted shares";
  const ad = String(acquisitionDisposition || "").trim().toUpperCase();
  if (ad === "A") return `Acquired shares (${code || "Form 4"})`;
  if (ad === "D") return `Disposed shares (${code || "Form 4"})`;
  return `Filed Form 4 (${code || "trade"})`;
}
