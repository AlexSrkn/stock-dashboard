import { getYahooFinance } from "../market/yahooClient.js";

const CACHE_MS = 60 * 1000;

function yahooNum(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "raw" in value) {
    const raw = (value as { raw: unknown }).raw;
    return raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const cache = new Map<string, { loadedAt: number; price: number | null; currency: string }>();

/** Latest regular-market price from Yahoo Finance. */
export async function fetchStockPrice(
  symbol: string
): Promise<{ price: number | null; currency: string }> {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym) return { price: null, currency: "USD" };

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.loadedAt < CACHE_MS) {
    return { price: hit.price, currency: hit.currency };
  }

  let price: number | null = null;
  let currency = "USD";

  try {
    const quote = await getYahooFinance().quote(sym);
    price =
      yahooNum(quote.regularMarketPrice) ??
      yahooNum(quote.postMarketPrice) ??
      yahooNum(quote.preMarketPrice);
    currency = String(quote.currency || currency);
  } catch {
    /* fall through to quoteSummary */
  }

  if (price == null) {
    try {
      const summary = await getYahooFinance().quoteSummary(sym, { modules: ["price"] });
      const p = summary.price;
      price =
        yahooNum(p?.regularMarketPrice) ??
        yahooNum(p?.postMarketPrice) ??
        yahooNum(p?.preMarketPrice);
      currency = String(p?.currency || currency);
    } catch {
      /* no price */
    }
  }

  cache.set(sym, { loadedAt: Date.now(), price, currency });
  return { price, currency };
}
