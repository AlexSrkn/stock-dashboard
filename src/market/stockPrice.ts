/** Live market price — Yahoo removed; no external price provider wired. */
export async function fetchStockPrice(
  _symbol: string
): Promise<{ price: number | null; currency: string }> {
  return { price: null, currency: "USD" };
}
