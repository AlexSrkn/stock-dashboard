/**
 * Client-side SEO helpers for the InvestAtlant SPA.
 * Updates title, description, canonical, and Open Graph tags on navigation.
 *
 * Note: crawlers that don't execute JS still see index.html defaults.
 * Full SSR is a later upgrade; this covers SPA navigations + social share tools
 * that re-fetch after load, plus robots.txt / dynamic sitemap.xml.
 */

export const SITE_ORIGIN = "https://investatlant.com";
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/assets/apple-touch-icon.png`;

/** @typedef {{ title: string, description: string, canonicalPath?: string, noindex?: boolean, ogType?: string }} SeoMeta */

/** @type {Record<string, SeoMeta>} */
const EXACT = {
  "/": {
    title: "InvestAtlant — Stock & institutional research",
    description:
      "InvestAtlant surfaces publicly disclosed trades and the research behind them — see what institutions and insiders are buying or selling, which securities they move into, and when, including congressional PTR filings under the STOCK Act.",
  },
  "/stocks": {
    title: "Stocks — InvestAtlant",
    description:
      "Explore equities with ownership intelligence, fundamentals context, and research tools on InvestAtlant.",
  },
  "/institutions": {
    title: "Institutional Investors — 13F Holdings Directory | InvestAtlant",
    description:
      "Browse tracked institutional investors and their 13F holdings, activity, and portfolio history on InvestAtlant.",
  },
  "/institutions/notable-investors": {
    title: "Notable investors — InvestAtlant",
    description: "Browse notable institutional investors tracked on InvestAtlant.",
  },
  "/institutions/performance": {
    title: "Institution performance — InvestAtlant",
    description: "Compare institutional portfolio performance proxies on InvestAtlant.",
  },
  "/institutions/most-accumulated": {
    title: "Institutional Buying — Most Accumulated Stocks | InvestAtlant",
    description:
      "See stocks with the most institutional buying from 13F filings — net shares added by tracked funds on InvestAtlant.",
  },
  "/insiders": {
    title: "Insider Trading — Recent Form 4 Buys & Sales | InvestAtlant",
    description:
      "See recent insider trading from SEC Form 4 filings — open-market buys and sales on InvestAtlant.",
    canonicalPath: "/insiders/trades",
  },
  "/insiders/trades": {
    title: "Insider Trading — Recent Form 4 Buys & Sales | InvestAtlant",
    description:
      "See recent insider trading from SEC Form 4 filings — open-market buys and sales on InvestAtlant.",
  },
  "/insiders/conviction-buys": {
    title: "Insider Buys — High-Conviction Form 4 Purchases | InvestAtlant",
    description:
      "Track high-conviction insider buys from SEC Form 4 open-market purchases on InvestAtlant.",
  },
  "/politicians": {
    title: "Congress Trading — Recent Politician Stock Trades | InvestAtlant",
    description:
      "Follow recent congressional stock trades disclosed under the STOCK Act (House and Senate PTR filings) on InvestAtlant.",
    canonicalPath: "/politicians/trades",
  },
  "/politicians/trades": {
    title: "Congress Trading — Recent Politician Stock Trades | InvestAtlant",
    description:
      "Follow recent congressional stock trades disclosed under the STOCK Act (House and Senate PTR filings) on InvestAtlant.",
  },
  "/politicians/most-accumulated": {
    title: "Congress Stock Buys — Most Accumulated by Politicians | InvestAtlant",
    description:
      "See stocks most accumulated by members of Congress from publicly disclosed PTR filings on InvestAtlant.",
  },
  "/sector": {
    title: "Sectors — InvestAtlant",
    description:
      "Analyze sector and industry accumulation, buying, selling, and fundamentals on InvestAtlant.",
  },
  "/signals": {
    title: "Signals — InvestAtlant",
    description:
      "Explore multi-factor research signals including institutional discovery, double/triple signals, and more.",
  },
  "/signals/double-signal": {
    title: "Double Signal — InvestAtlant",
    description: "Find stocks where institutional and insider activity align on InvestAtlant.",
  },
  "/signals/triple-signal": {
    title: "Triple Signal — InvestAtlant",
    description: "Find stocks with strong multi-factor alignment across filings on InvestAtlant.",
  },
  "/signals/conflict-signals": {
    title: "Conflict Signals — InvestAtlant",
    description: "Spot divergence between institutional and insider activity on InvestAtlant.",
  },
  "/signals/hidden-gems": {
    title: "Hidden Gems — InvestAtlant",
    description: "Discover lesser-known names with notable filing activity on InvestAtlant.",
  },
  "/signals/conviction-score": {
    title: "Conviction Score — InvestAtlant",
    description: "Rank stocks by conviction from institutional and insider filings on InvestAtlant.",
  },
  "/signals/institutional-discovery": {
    title: "Institutional Discovery — InvestAtlant",
    description: "See where institutions are building new positions on InvestAtlant.",
  },
  "/signals/smart-money": {
    title: "Smart Money — InvestAtlant",
    description: "Follow smart-money style institutional activity patterns on InvestAtlant.",
  },
  "/signals/top-institution-new-entries": {
    title: "Top institution new entries — InvestAtlant",
    description: "Track new institutional positions from major filers on InvestAtlant.",
  },
  "/tools": {
    title: "Tools — InvestAtlant",
    description:
      "Valuation and research calculators including DCF, WACC, EPV, and similar-stock tools.",
  },
  "/tools/dcf": {
    title: "DCF calculator — InvestAtlant",
    description: "Discounted cash flow valuation calculator on InvestAtlant.",
  },
  "/tools/wacc": {
    title: "WACC calculator — InvestAtlant",
    description: "Weighted average cost of capital calculator on InvestAtlant.",
  },
  "/premium": {
    title: "Premium — InvestAtlant",
    description: "Learn about InvestAtlant Premium access and upcoming paid features.",
  },
  "/admin": {
    title: "Admin — InvestAtlant",
    description: "Admin tools for managing InvestAtlant user plans.",
    noindex: true,
  },
  "/pricing": {
    title: "Premium — InvestAtlant",
    description: "Learn about InvestAtlant Premium access and upcoming paid features.",
    canonicalPath: "/premium",
  },
  "/faq": {
    title: "FAQ — InvestAtlant",
    description:
      "InvestAtlant surfaces publicly disclosed trades and the research behind them — institutions, insiders, and congressional PTR filings under the STOCK Act.",
  },
  "/methodology": {
    title: "Methodology — InvestAtlant",
    description: "How InvestAtlant builds research views from public market disclosures and filings.",
  },
  "/data-sources": {
    title: "Data Sources — InvestAtlant",
    description: "Public data sources used by InvestAtlant, including SEC filings and market data.",
  },
  "/about": {
    title: "About — InvestAtlant",
    description: "About InvestAtlant — financial research and market intelligence tools.",
  },
  "/contact": {
    title: "Contact — InvestAtlant",
    description: "Contact InvestAtlant for product questions, data issues, or privacy requests.",
  },
  "/login": {
    title: "Log in — InvestAtlant",
    description: "Log in to your InvestAtlant account.",
    noindex: true,
  },
  "/register": {
    title: "Create account — InvestAtlant",
    description: "Create a free InvestAtlant account.",
    noindex: true,
  },
  "/check-email": {
    title: "Check your email — InvestAtlant",
    description: "Verify your InvestAtlant email address.",
    noindex: true,
  },
  "/forgot-password": {
    title: "Reset password — InvestAtlant",
    description: "Reset your InvestAtlant password.",
    noindex: true,
  },
  "/reset-password": {
    title: "Choose a new password — InvestAtlant",
    description: "Choose a new InvestAtlant password.",
    noindex: true,
  },
  "/legal/cookies": {
    title: "Cookie Policy — InvestAtlant",
    description: "Cookie Policy for InvestAtlant.",
  },
  "/legal/privacy": {
    title: "Privacy Policy — InvestAtlant",
    description: "Privacy Policy for InvestAtlant.",
  },
  "/legal/terms": {
    title: "Terms of Service — InvestAtlant",
    description: "Terms of Service for InvestAtlant.",
  },
  "/legal/disclaimer": {
    title: "Disclaimer — InvestAtlant",
    description: "Investment and research disclaimer for InvestAtlant.",
  },
  "/legal/impressum": {
    title: "Impressum — InvestAtlant",
    description: "Legal imprint for InvestAtlant.",
  },
};

/**
 * @param {string} pathname
 */
function normalizePath(pathname) {
  let p = String(pathname || "/").split("?")[0].split("#")[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

/**
 * @param {string} path
 * @param {{ name?: string | null, symbol?: string | null, cik?: string | null }} [entity]
 * @returns {SeoMeta}
 */
export function resolveSeoMeta(path, entity = {}) {
  const p = normalizePath(path);
  if (EXACT[p]) return { ...EXACT[p], canonicalPath: EXACT[p].canonicalPath || p };

  const stock = p.match(/^\/stock\/([^/]+)/i);
  if (stock) {
    const sym = String(entity.symbol || decodeURIComponent(stock[1]) || "")
      .trim()
      .toUpperCase();
    const name = String(entity.name || "").trim();
    const label = name && name.toUpperCase() !== sym ? name : null;
    const title = label
      ? `${label} (${sym}) Stock — Insider Trading, Institutional Ownership & SEC Filings`
      : `${sym} Stock — Insider Trading, Institutional Ownership & SEC Filings`;
    const description = label
      ? `See ${label} (${sym}) insider trading, institutional ownership, and SEC filings on InvestAtlant.`
      : `See ${sym} insider trading, institutional ownership, and SEC filings on InvestAtlant.`;
    return {
      title,
      description,
      canonicalPath: `/stock/${encodeURIComponent(sym)}`,
    };
  }

  const institution = p.match(/^\/institution\/(\d+)/i);
  if (institution) {
    const cik = String(entity.cik || institution[1] || "").replace(/^0+/, "") || institution[1];
    const name = String(entity.name || "").trim();
    return {
      title: name
        ? `${name} — Institutional holdings | InvestAtlant`
        : `Institution ${cik} — Holdings | InvestAtlant`,
      description: name
        ? `Holdings, activity, and ownership history for ${name} on InvestAtlant.`
        : `Institutional filer profile, holdings, and activity on InvestAtlant.`,
      canonicalPath: `/institution/${cik}`,
    };
  }

  if (p.startsWith("/institutions/")) {
    return {
      title: "Institutions — InvestAtlant",
      description: EXACT["/institutions"].description,
      canonicalPath: p,
    };
  }
  if (p.startsWith("/insiders/")) {
    return {
      title: "Insiders — InvestAtlant",
      description: EXACT["/insiders"].description,
      canonicalPath: p,
    };
  }
  if (p.startsWith("/politicians/")) {
    return {
      title: "Politicians — InvestAtlant",
      description: EXACT["/politicians"].description,
      canonicalPath: p,
    };
  }
  if (p.startsWith("/sector/")) {
    return {
      title: "Sectors — InvestAtlant",
      description: EXACT["/sector"].description,
      canonicalPath: p,
    };
  }
  if (p.startsWith("/signals/")) {
    return {
      title: "Signals — InvestAtlant",
      description: EXACT["/signals"].description,
      canonicalPath: p,
    };
  }
  if (p.startsWith("/tools/")) {
    return {
      title: "Tools — InvestAtlant",
      description: EXACT["/tools"].description,
      canonicalPath: p,
    };
  }
  if (p.startsWith("/stocks/")) {
    return {
      title: "Stocks — InvestAtlant",
      description: EXACT["/stocks"].description,
      canonicalPath: p,
    };
  }

  return {
    title: "InvestAtlant",
    description: EXACT["/"].description,
    canonicalPath: p,
  };
}

/**
 * @param {"name"|"property"} attr
 * @param {string} key
 * @param {string} content
 */
function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/**
 * @param {string} rel
 * @param {string} href
 */
function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * @param {SeoMeta} meta
 * @param {string} [pathname]
 */
function commitSeoMeta(meta, pathname = window.location.pathname) {
  const canonicalPath = meta.canonicalPath || normalizePath(pathname);
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath === "/" ? "/" : canonicalPath}`;
  const ogType = meta.ogType || "website";

  document.title = meta.title;
  upsertMeta("name", "description", meta.description);
  upsertMeta("name", "robots", meta.noindex ? "noindex, nofollow" : "index, follow");
  upsertLink("canonical", canonicalUrl);

  upsertMeta("property", "og:site_name", "InvestAtlant");
  upsertMeta("property", "og:type", ogType);
  upsertMeta("property", "og:title", meta.title);
  upsertMeta("property", "og:description", meta.description);
  upsertMeta("property", "og:url", canonicalUrl);
  upsertMeta("property", "og:image", DEFAULT_OG_IMAGE);

  upsertMeta("name", "twitter:card", "summary");
  upsertMeta("name", "twitter:title", meta.title);
  upsertMeta("name", "twitter:description", meta.description);
  upsertMeta("name", "twitter:image", DEFAULT_OG_IMAGE);
}

/**
 * Apply SEO tags for the current (or given) path.
 * @param {string} [pathname]
 */
export function applySeo(pathname = window.location.pathname) {
  commitSeoMeta(resolveSeoMeta(pathname), pathname);
}

/**
 * Enrich SEO after entity names load (stock / institution).
 * @param {{ path?: string, title?: string, description?: string, name?: string | null, symbol?: string | null, cik?: string | null }} input
 */
export function applySeoForEntity(input = {}) {
  const path = input.path || window.location.pathname;
  const base = resolveSeoMeta(path, {
    name: input.name,
    symbol: input.symbol,
    cik: input.cik,
  });
  const meta = {
    ...base,
    title: input.title || base.title,
    description: input.description || base.description,
  };
  commitSeoMeta(meta, path);
}
