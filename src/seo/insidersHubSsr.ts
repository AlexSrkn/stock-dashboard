/**
 * Server-side HTML for insider hubs (/insiders/trades, /insiders/conviction-buys)
 * so crawlers see keyword-rich titles + Form 4 tables without executing the SPA.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type http from "node:http";
import { getRecentInsiderTransactions } from "../insider/insiderAnalytics.js";
import { getConvictionBuys } from "../insider/convictionBuys/service.js";
import type { InsiderTransactionRow } from "../db/insiderTransactions.js";
import type { ConvictionBuyRow } from "../insider/convictionBuys/types.js";
import { SITE_ORIGIN } from "./sitemap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const INDEX_PATH = path.join(ROOT, "index.html");

const DATA_TIMEOUT_MS = 2500;
const ROW_LIMIT = 15;

export type InsidersHubKind = "trades" | "conviction-buys";

export type InsidersHubSsrData = {
  kind: InsidersHubKind;
  canonicalPath: string;
  title: string;
  description: string;
  trades: InsiderTransactionRow[];
  convictionBuys: ConvictionBuyRow[];
};

let cachedIndexHtml: string | null = null;
let cachedIndexMtimeMs = 0;

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUsd(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(Number(usd))) return "—";
  const abs = Math.abs(Number(usd));
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

function codeLabel(code: string): string {
  const c = String(code || "").toUpperCase();
  if (c === "P") return "Purchase";
  if (c === "S") return "Sale";
  return c || "—";
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function normalizePath(pathname: string): string {
  let p = String(pathname || "/").split("?")[0].split("#")[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

export function parseInsidersHubKind(pathname: string): InsidersHubKind | null {
  const p = normalizePath(pathname);
  if (p === "/insiders" || p === "/insiders/trades") return "trades";
  if (p === "/insiders/conviction-buys") return "conviction-buys";
  return null;
}

export function buildInsidersHubSeoMeta(kind: InsidersHubKind): {
  title: string;
  description: string;
  canonicalPath: string;
} {
  if (kind === "conviction-buys") {
    return {
      title: "Insider Buys — High-Conviction Form 4 Purchases | InvestAtlant",
      description:
        "Track high-conviction insider buys from SEC Form 4 open-market purchases on InvestAtlant.",
      canonicalPath: "/insiders/conviction-buys",
    };
  }
  return {
    title: "Insider Trading — Recent Form 4 Buys & Sales | InvestAtlant",
    description:
      "See recent insider trading from SEC Form 4 filings — open-market buys and sales on InvestAtlant.",
    canonicalPath: "/insiders/trades",
  };
}

async function loadTrades(): Promise<InsiderTransactionRow[]> {
  const high = await getRecentInsiderTransactions({
    limit: ROW_LIMIT,
    signal: "high",
    sort: "date",
  });
  if (high.transactions?.length) {
    return high.transactions.slice(0, ROW_LIMIT);
  }
  const any = await getRecentInsiderTransactions({
    limit: ROW_LIMIT,
    signal: "all",
    sort: "date",
  });
  return (any.transactions || []).slice(0, ROW_LIMIT);
}

async function loadConvictionBuys(): Promise<ConvictionBuyRow[]> {
  const url = new URL("http://localhost/api/insiders/conviction-buys?page=1&pageSize=15&sort=convictionScore&sortDir=desc");
  const payload = await getConvictionBuys(url);
  return (payload.rows || []).slice(0, ROW_LIMIT);
}

export async function loadInsidersHubSsrData(kind: InsidersHubKind): Promise<InsidersHubSsrData> {
  const meta = buildInsidersHubSeoMeta(kind);
  if (kind === "conviction-buys") {
    const convictionBuys = await withTimeout(
      loadConvictionBuys(),
      DATA_TIMEOUT_MS,
      [] as ConvictionBuyRow[]
    );
    return {
      kind,
      ...meta,
      trades: [],
      convictionBuys,
    };
  }

  const trades = await withTimeout(loadTrades(), DATA_TIMEOUT_MS, [] as InsiderTransactionRow[]);
  return {
    kind,
    ...meta,
    trades,
    convictionBuys: [],
  };
}

function stockLink(ticker: string | null | undefined): string {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) return "—";
  return `<a href="/stock/${escapeHtml(encodeURIComponent(sym))}">${escapeHtml(sym)}</a>`;
}

function renderTradesTable(rows: InsiderTransactionRow[]): string {
  if (!rows.length) {
    return `<p>No recent insider trades available yet. Check back after the next Form 4 ingest.</p>`;
  }
  const body = rows
    .map((t) => {
      const date = escapeHtml(t.transactionDate || t.filingDate || "—");
      const name = escapeHtml(t.insiderName || "—");
      const title = escapeHtml(t.insiderTitle || "—");
      const code = escapeHtml(codeLabel(t.transactionCode));
      const value = escapeHtml(formatUsd(t.transactionValue));
      return `<tr>
  <td>${date}</td>
  <td>${name}</td>
  <td>${stockLink(t.ticker)}</td>
  <td>${title}</td>
  <td>${code}</td>
  <td>${value}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>Recent Form 4 trades</h2>
<table>
  <thead><tr><th>Date</th><th>Insider</th><th>Stock</th><th>Title</th><th>Type</th><th>Value</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

function renderConvictionTable(rows: ConvictionBuyRow[]): string {
  if (!rows.length) {
    return `<p>No high-conviction insider buys in cache yet. Run the conviction-buys warm job, or check back soon.</p>`;
  }
  const body = rows
    .map((r) => {
      const date = escapeHtml(r.transactionDate || r.filingDate || "—");
      const name = escapeHtml(r.insiderName || "—");
      const company = escapeHtml(r.companyName || "—");
      const score = escapeHtml(String(r.convictionScore ?? "—"));
      const label = escapeHtml(r.convictionLabel || "—");
      const value = escapeHtml(formatUsd(r.valueUsd));
      return `<tr>
  <td>${date}</td>
  <td>${name}</td>
  <td>${stockLink(r.ticker)}</td>
  <td>${company}</td>
  <td>${score} (${label})</td>
  <td>${value}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>High-conviction insider buys</h2>
<table>
  <thead><tr><th>Date</th><th>Insider</th><th>Stock</th><th>Company</th><th>Conviction</th><th>Value</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

export function renderInsidersHubSsrBody(data: InsidersHubSsrData): string {
  const isBuys = data.kind === "conviction-buys";
  const h1 = isBuys ? "Insider Buys" : "Insider Trading";
  const blurb = isBuys
    ? "High-conviction open-market insider purchases from SEC Form 4 filings, scored for size, role, ownership increase, and repeat buying."
    : "Recent insider trading from SEC Form 4 filings — open-market buys and sales disclosed by officers, directors, and other insiders.";

  return `<section id="seo-insiders-ssr" class="seo-insiders-ssr" data-hub="${escapeHtml(data.kind)}">
  <article>
    <h1>${h1}</h1>
    <p>${blurb}</p>
    <nav aria-label="Insider hubs">
      <a href="/insiders/trades">Recent trades</a> ·
      <a href="/insiders/conviction-buys">Conviction Buys</a> ·
      <a href="/insiders/clusters">Cluster buying</a> ·
      <a href="/insiders/sentiment">Insider Sentiment</a>
    </nav>
    ${isBuys ? renderConvictionTable(data.convictionBuys) : renderTradesTable(data.trades)}
  </article>
</section>`;
}

function renderJsonLd(data: InsidersHubSsrData): string {
  const payload = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: data.title,
    description: data.description,
    url: `${SITE_ORIGIN}${data.canonicalPath}`,
    isPartOf: {
      "@type": "WebSite",
      name: "InvestAtlant",
      url: SITE_ORIGIN,
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
}

function replaceMetaContent(html: string, attr: string, value: string): string {
  const re = new RegExp(`(<meta[^>]*${attr}[^>]*content=")([^"]*)(")`, "i");
  if (re.test(html)) return html.replace(re, `$1${escapeHtml(value)}$3`);
  return html;
}

function replaceLinkHref(html: string, rel: string, href: string): string {
  const re = new RegExp(`(<link[^>]*rel="${rel}"[^>]*href=")([^"]*)(")`, "i");
  if (re.test(html)) return html.replace(re, `$1${escapeHtml(href)}$3`);
  return html;
}

function replaceTitle(html: string, title: string): string {
  return html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
}

function readIndexHtml(): string {
  try {
    const stat = fs.statSync(INDEX_PATH);
    if (cachedIndexHtml && cachedIndexMtimeMs === stat.mtimeMs) return cachedIndexHtml;
    cachedIndexHtml = fs.readFileSync(INDEX_PATH, "utf8");
    cachedIndexMtimeMs = stat.mtimeMs;
    return cachedIndexHtml;
  } catch {
    cachedIndexHtml = null;
    throw new Error("index.html unavailable");
  }
}

export function injectInsidersHubSsr(indexHtml: string, data: InsidersHubSsrData): string {
  const canonicalUrl = `${SITE_ORIGIN}${data.canonicalPath}`;
  let html = indexHtml;

  html = replaceTitle(html, data.title);
  html = replaceMetaContent(html, 'name="description"', data.description);
  html = replaceLinkHref(html, "canonical", canonicalUrl);
  html = replaceMetaContent(html, 'property="og:title"', data.title);
  html = replaceMetaContent(html, 'property="og:description"', data.description);
  html = replaceMetaContent(html, 'property="og:url"', canonicalUrl);
  html = replaceMetaContent(html, 'property="og:type"', "website");
  html = replaceMetaContent(html, 'name="twitter:title"', data.title);
  html = replaceMetaContent(html, 'name="twitter:description"', data.description);

  const bodyBlock = `${renderJsonLd(data)}\n${renderInsidersHubSsrBody(data)}`;
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${bodyBlock}\n`);
  }

  if (!html.includes('html[data-boot="app"] #seo-insiders-ssr')) {
    html = html.replace(
      "</style>",
      `html[data-boot="app"] #seo-insiders-ssr {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      </style>`
    );
  }

  return html;
}

export async function renderInsidersHubHtml(kind: InsidersHubKind): Promise<string> {
  const data = await loadInsidersHubSsrData(kind);
  return injectInsidersHubSsr(readIndexHtml(), data);
}

export async function tryHandleInsidersHubSsr(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const kind = parseInsidersHubKind(url.pathname);
  if (!kind) return false;

  try {
    const html = await renderInsidersHubHtml(kind);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
    });
    res.end(html);
  } catch (err) {
    console.warn(
      "[seo-insiders-ssr] Falling back to plain index.html:",
      err instanceof Error ? err.message : err
    );
    return false;
  }

  return true;
}
