/**
 * Stock intent URL aliases for SEO.
 * Internal tab ids stay the same; public paths use keyword slugs.
 */

/** Tab id → preferred public URL slug (null = /stock/TICKER only). */
export const STOCK_TAB_TO_SEO_SLUG = {
  overview: null,
  signals: "signals",
  "filings-fundamentals": "filings-fundamentals",
  ownership: "institutional-ownership",
  activity: "activity",
  "insider-activity": "insider-trading",
  "congress-activity": "congress-activity",
  "sec-filings": "sec-filings",
};

/**
 * Public slug → internal tab id.
 * Includes legacy slugs so old links keep working.
 */
export const STOCK_SEO_SLUG_TO_TAB = {
  "insider-trading": "insider-activity",
  "insider-activity": "insider-activity",
  "institutional-ownership": "ownership",
  ownership: "ownership",
  "13f": "ownership",
  "sec-filings": "sec-filings",
  filings: "sec-filings",
  signals: "signals",
  "filings-fundamentals": "filings-fundamentals",
  activity: "activity",
  "congress-activity": "congress-activity",
};

/** Intent slugs to list in the sitemap (per S&P ticker). */
export const STOCK_INTENT_SITEMAP_SLUGS = [
  "insider-trading",
  "institutional-ownership",
  "13f",
  "sec-filings",
];

/**
 * @param {string} slug
 * @returns {string | null} tab id, or null if unknown
 */
export function resolveStockTabFromSlug(slug) {
  if (!slug) return "overview";
  const key = String(slug || "")
    .trim()
    .toLowerCase();
  if (!key) return "overview";
  return STOCK_SEO_SLUG_TO_TAB[key] || null;
}

/**
 * Canonical public path for a stock tab.
 * `/13f` aliases ownership but canonicalizes to `/institutional-ownership`.
 * @param {string} symbol
 * @param {string} [tab]
 */
export function stockSeoPath(symbol, tab = "overview") {
  const sym = encodeURIComponent(String(symbol || "").trim().toUpperCase());
  if (!sym) return "/stocks";
  const t = String(tab || "overview");
  if (t === "overview") return `/stock/${sym}`;
  const slug = STOCK_TAB_TO_SEO_SLUG[t];
  if (!slug) return `/stock/${sym}/${encodeURIComponent(t)}`;
  return `/stock/${sym}/${slug}`;
}

/**
 * @param {string} pathname
 * @returns {{ symbol: string, tab: string, slug: string | null, canonicalPath: string } | null}
 */
export function parseStockIntentPath(pathname) {
  const m = String(pathname || "").match(/^\/stock\/([^/]+)(?:\/([^/]+))?\/?$/i);
  if (!m) return null;
  let symbol;
  try {
    symbol = decodeURIComponent(m[1] || "")
      .trim()
      .toUpperCase();
  } catch {
    return null;
  }
  if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol)) return null;

  const rawSlug = m[2] ? String(m[2]).trim().toLowerCase() : null;
  if (!rawSlug) {
    return {
      symbol,
      tab: "overview",
      slug: null,
      canonicalPath: stockSeoPath(symbol, "overview"),
    };
  }

  const tab = resolveStockTabFromSlug(rawSlug);
  if (!tab) {
    return {
      symbol,
      tab: "overview",
      slug: rawSlug,
      canonicalPath: stockSeoPath(symbol, "overview"),
    };
  }

  return {
    symbol,
    tab,
    slug: rawSlug,
    canonicalPath: stockSeoPath(symbol, tab),
  };
}

/**
 * @param {string} symbol
 * @param {string | null} companyName
 * @param {string} tab
 * @param {string | null} [requestSlug] slug from the URL (e.g. 13f)
 */
export function buildStockIntentSeoMeta(symbol, companyName, tab = "overview", requestSlug = null) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  const name = String(companyName || "").trim();
  const label = name && name.toUpperCase() !== sym ? name : null;
  const who = label ? `${label} (${sym})` : sym;
  const canonicalPath = stockSeoPath(sym, tab);
  const slug = requestSlug || STOCK_TAB_TO_SEO_SLUG[tab] || null;

  if (tab === "insider-activity" || slug === "insider-trading") {
    return {
      title: `${who} Insider Trading — Form 4 Buys & Sales | InvestAtlant`,
      description: `Track ${who} insider trading from SEC Form 4 filings — open-market buys and sales on InvestAtlant.`,
      canonicalPath,
      h1: `${who} Insider Trading`,
      intent: "insider-trading",
    };
  }

  if (tab === "ownership" || slug === "institutional-ownership" || slug === "13f") {
    const is13f = slug === "13f";
    return {
      title: is13f
        ? `${who} 13F Holdings — Institutional Ownership | InvestAtlant`
        : `${who} Institutional Ownership — 13F Holders | InvestAtlant`,
      description: is13f
        ? `See ${who} 13F institutional holdings and ownership on InvestAtlant.`
        : `See ${who} institutional ownership from 13F filings — top holders and positions on InvestAtlant.`,
      canonicalPath, // always institutional-ownership
      h1: is13f ? `${who} 13F Holdings` : `${who} Institutional Ownership`,
      intent: is13f ? "13f" : "institutional-ownership",
    };
  }

  if (tab === "sec-filings" || slug === "sec-filings" || slug === "filings") {
    return {
      title: `${who} SEC Filings — 10-K, 10-Q & More | InvestAtlant`,
      description: `Browse ${who} SEC filings and related disclosure context on InvestAtlant.`,
      canonicalPath,
      h1: `${who} SEC Filings`,
      intent: "sec-filings",
    };
  }

  return {
    title: `${who} Stock — Insider Trading, Institutional Ownership & SEC Filings`,
    description: `See ${who} insider trading, institutional ownership, and SEC filings on InvestAtlant.`,
    canonicalPath,
    h1: who,
    intent: "overview",
  };
}
