/**
 * Dynamic sitemap.xml builder for InvestAtlant.
 * Hubs + signal pages + S&P 500 stocks + tracked institutions.
 */
import type http from "node:http";
import { loadSp500 } from "../stocks/sp500.js";
import {
  reloadTrackedInstitutions,
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "../ownership/trackedInstitutions.js";

export const SITE_ORIGIN = "https://investatlant.com";

const CACHE_TTL_MS = 60 * 60 * 1000;

type SitemapEntry = {
  path: string;
  changefreq?: string;
  priority?: string;
};

const HUB_ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/stocks", changefreq: "daily", priority: "0.9" },
  { path: "/institutions", changefreq: "daily", priority: "0.8" },
  { path: "/institutions/most-accumulated", changefreq: "daily", priority: "0.85" },
  { path: "/insiders", changefreq: "daily", priority: "0.8" },
  { path: "/insiders/trades", changefreq: "daily", priority: "0.85" },
  { path: "/insiders/conviction-buys", changefreq: "daily", priority: "0.85" },
  { path: "/politicians", changefreq: "daily", priority: "0.8" },
  { path: "/politicians/trades", changefreq: "daily", priority: "0.85" },
  { path: "/politicians/most-accumulated", changefreq: "daily", priority: "0.85" },
  { path: "/sector", changefreq: "weekly", priority: "0.7" },
  { path: "/signals", changefreq: "daily", priority: "0.8" },
  { path: "/tools", changefreq: "weekly", priority: "0.7" },
  { path: "/faq", changefreq: "monthly", priority: "0.6" },
  { path: "/methodology", changefreq: "monthly", priority: "0.5" },
  { path: "/data-sources", changefreq: "monthly", priority: "0.5" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/contact", changefreq: "monthly", priority: "0.5" },
  { path: "/premium", changefreq: "monthly", priority: "0.4" },
  { path: "/legal/privacy", changefreq: "yearly", priority: "0.2" },
  { path: "/legal/terms", changefreq: "yearly", priority: "0.2" },
  { path: "/legal/disclaimer", changefreq: "yearly", priority: "0.2" },
  { path: "/legal/cookies", changefreq: "yearly", priority: "0.2" },
  { path: "/legal/impressum", changefreq: "yearly", priority: "0.2" },
];

const SIGNAL_ENTRIES: SitemapEntry[] = [
  { path: "/signals/double-signal", changefreq: "daily", priority: "0.75" },
  { path: "/signals/triple-signal", changefreq: "daily", priority: "0.75" },
  { path: "/signals/conflict-signals", changefreq: "daily", priority: "0.75" },
  { path: "/signals/hidden-gems", changefreq: "daily", priority: "0.75" },
  { path: "/signals/conviction-score", changefreq: "daily", priority: "0.75" },
  { path: "/signals/institutional-discovery", changefreq: "daily", priority: "0.75" },
  { path: "/signals/smart-money", changefreq: "daily", priority: "0.75" },
  { path: "/signals/top-institution-new-entries", changefreq: "daily", priority: "0.7" },
];

let cachedXml: string | null = null;
let cachedAt = 0;

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function bareCik(cik: string): string {
  return String(cik || "").replace(/\D/g, "").replace(/^0+/, "") || "0";
}

function locFor(path: string): string {
  if (path === "/") return `${SITE_ORIGIN}/`;
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

function entryXml(entry: SitemapEntry): string {
  const parts = [`    <loc>${escapeXml(locFor(entry.path))}</loc>`];
  if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  if (entry.priority) parts.push(`    <priority>${entry.priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

function collectStockEntries(): SitemapEntry[] {
  try {
    const payload = loadSp500();
    const seen = new Set<string>();
    const out: SitemapEntry[] = [];
    const intentSlugs = ["insider-trading", "institutional-ownership", "13f", "sec-filings"];
    for (const stock of payload.stocks || []) {
      const sym = String(stock.symbol || "")
        .trim()
        .toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      const enc = encodeURIComponent(sym);
      out.push({
        path: `/stock/${enc}`,
        changefreq: "weekly",
        priority: "0.65",
      });
      for (const slug of intentSlugs) {
        out.push({
          path: `/stock/${enc}/${slug}`,
          changefreq: "weekly",
          priority: slug === "13f" ? "0.55" : "0.6",
        });
      }
    }
    return out;
  } catch (err) {
    console.warn("[sitemap] Failed to load S&P 500 list:", err instanceof Error ? err.message : err);
    return [];
  }
}

function collectInstitutionEntries(): SitemapEntry[] {
  try {
    reloadTrackedInstitutions();
    const seen = new Set<string>();
    const out: SitemapEntry[] = [];
    for (const fund of TRACKED_INSTITUTIONAL_MANAGERS) {
      const cik = bareCik(String(fund.cik || ""));
      if (!cik || cik === "0" || seen.has(cik)) continue;
      seen.add(cik);
      out.push({
        path: `/institution/${cik}`,
        changefreq: "weekly",
        priority: "0.55",
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[sitemap] Failed to load tracked institutions:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

export function buildSitemapXml(): string {
  const entries: SitemapEntry[] = [
    ...HUB_ENTRIES,
    ...SIGNAL_ENTRIES,
    ...collectStockEntries(),
    ...collectInstitutionEntries(),
  ];

  const seen = new Set<string>();
  const unique: SitemapEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    unique.push(entry);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...unique.map(entryXml),
    `</urlset>`,
    ``,
  ].join("\n");
}

export function getSitemapXml({ force = false }: { force?: boolean } = {}): string {
  const now = Date.now();
  if (!force && cachedXml && now - cachedAt < CACHE_TTL_MS) return cachedXml;
  cachedXml = buildSitemapXml();
  cachedAt = now;
  return cachedXml;
}

/**
 * GET /sitemap.xml — dynamic sitemap (hubs, signals, S&P 500, tracked institutions).
 */
export async function tryHandleSitemap(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (url.pathname !== "/sitemap.xml") return false;

  try {
    const xml = getSitemapXml();
    res.writeHead(200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(xml);
  } catch (err) {
    console.error("[sitemap]", err instanceof Error ? err.message : err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Sitemap unavailable");
  }
  return true;
}
