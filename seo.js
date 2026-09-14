/**
 * Client-side SEO helpers for the InvestAtlant SPA.
 * Updates title, description, canonical, and Open Graph tags on navigation.
 *
 * Note: crawlers that don't execute JS still see index.html defaults.
 * Full SSR is a later upgrade; this covers SPA navigations + social share tools
 * that re-fetch after load, plus static robots.txt / sitemap.xml.
 */

export const SITE_ORIGIN = "https://investatlant.com";
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/assets/apple-touch-icon.png`;

/** @typedef {{ title: string, description: string, canonicalPath?: string, noindex?: boolean, ogType?: string }} SeoMeta */

/** @type {Record<string, SeoMeta>} */
const EXACT = {
  "/": {
    title: "InvestAtlant — Stock & institutional research",
    description:
      "Research stocks with institutional ownership, insider Form 4 activity, politician trades, sectors, and signals — built for serious market research.",
  },
  "/stocks": {
    title: "Stocks — InvestAtlant",
    description:
      "Explore equities with ownership intelligence, fundamentals context, and research tools on InvestAtlant.",
  },
  "/institutions": {
    title: "Institutions — InvestAtlant",
    description:
      "Browse 13F institutional filers, holdings, and portfolio activity on InvestAtlant.",
  },
  "/insiders": {
    title: "Insiders — InvestAtlant",
    description:
      "Track SEC Form 4 insider transactions, clusters, and buying patterns on InvestAtlant.",
  },
  "/politicians": {
    title: "Politicians — InvestAtlant",
    description:
      "Follow congressional trading disclosures and politician portfolio activity on InvestAtlant.",
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
  "/tools": {
    title: "Tools — InvestAtlant",
    description:
      "Valuation and research calculators including DCF, WACC, EPV, and similar-stock tools.",
  },
  "/premium": {
    title: "Premium — InvestAtlant",
    description: "Learn about InvestAtlant Premium access and upcoming paid features.",
  },
  "/pricing": {
    title: "Premium — InvestAtlant",
    description: "Learn about InvestAtlant Premium access and upcoming paid features.",
    canonicalPath: "/premium",
  },
  "/faq": {
    title: "FAQ — InvestAtlant",
    description:
      "Answers about InvestAtlant accounts, data sources, research views, and Premium.",
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
 * @returns {SeoMeta}
 */
export function resolveSeoMeta(path) {
  const p = normalizePath(path);
  if (EXACT[p]) return { ...EXACT[p], canonicalPath: EXACT[p].canonicalPath || p };

  const stock = p.match(/^\/stock\/([^/]+)/i);
  if (stock) {
    const sym = decodeURIComponent(stock[1]).toUpperCase();
    return {
      title: `${sym} — InvestAtlant`,
      description: `Research ${sym}: ownership, insider activity, and market context on InvestAtlant.`,
      canonicalPath: `/stock/${encodeURIComponent(sym)}`,
    };
  }

  if (p.startsWith("/institutions/") || p.startsWith("/institution/")) {
    return {
      title: "Institution — InvestAtlant",
      description: "Institutional filer profile, holdings, and activity on InvestAtlant.",
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
 * Apply SEO tags for the current (or given) path.
 * @param {string} [pathname]
 */
export function applySeo(pathname = window.location.pathname) {
  const meta = resolveSeoMeta(pathname);
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
