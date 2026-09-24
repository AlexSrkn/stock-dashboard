/**
 * Server-side HTML for /stock/:TICKER so crawlers see real title/meta + content
 * without executing the SPA. The interactive UI still boots from index.html.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type http from "node:http";
import { getStocksRepository } from "../stocks/stocksRepository.js";
import { getPool } from "../db/pool.js";
import { getTopHolders } from "../ownership/ownershipAnalytics.js";
import { getInsiderTransactions } from "../insider/insiderAnalytics.js";
import type { FundHoldingAggregate } from "../ownership/types.js";
import type { InsiderTransactionRow } from "../db/insiderTransactions.js";
import { SITE_ORIGIN } from "./sitemap.js";
import {
  buildStockIntentSeoMeta,
  parseStockIntentPath,
  stockSeoPath,
} from "../../stockIntentRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const INDEX_PATH = path.join(ROOT, "index.html");

const DATA_TIMEOUT_MS = 2500;
const HOLDER_LIMIT = 8;
const INSIDER_LIMIT = 8;

let cachedIndexHtml: string | null = null;
let cachedIndexMtimeMs = 0;

export type StockSsrIntent =
  | "overview"
  | "insider-trading"
  | "institutional-ownership"
  | "13f"
  | "sec-filings";

export type StockPageSsrData = {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  holders: FundHoldingAggregate[];
  holdersQuarter: string | null;
  insiders: InsiderTransactionRow[];
  canonicalPath: string;
  title: string;
  description: string;
  h1: string;
  intent: StockSsrIntent;
};

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

function formatShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Math.round(Number(n)).toLocaleString("en-US");
}

function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(2)}%`;
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

export function parseStockTickerFromPath(pathname: string): string | null {
  return parseStockIntentPath(pathname)?.symbol ?? null;
}

export function parseStockSsrIntent(pathname: string): StockSsrIntent {
  const parsed = parseStockIntentPath(pathname);
  if (!parsed) return "overview";
  const meta = buildStockIntentSeoMeta(parsed.symbol, null, parsed.tab, parsed.slug);
  return (meta.intent as StockSsrIntent) || "overview";
}

export function buildStockSeoMeta(
  ticker: string,
  companyName: string | null,
  intent: StockSsrIntent = "overview"
): { title: string; description: string; canonicalPath: string; h1: string; intent: StockSsrIntent } {
  const tab =
    intent === "insider-trading"
      ? "insider-activity"
      : intent === "institutional-ownership" || intent === "13f"
        ? "ownership"
        : intent === "sec-filings"
          ? "sec-filings"
          : "overview";
  const slug = intent === "overview" ? null : intent;
  const meta = buildStockIntentSeoMeta(ticker, companyName, tab, slug);
  return {
    title: meta.title,
    description: meta.description,
    canonicalPath: meta.canonicalPath,
    h1: meta.h1,
    intent: (meta.intent as StockSsrIntent) || "overview",
  };
}

export async function loadStockPageSsrData(
  ticker: string,
  intent: StockSsrIntent = "overview"
): Promise<StockPageSsrData> {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();

  let companyName: string | null = null;
  let sector: string | null = null;
  let industry: string | null = null;

  try {
    const stock = await withTimeout(getStocksRepository().getByTicker(sym), 800, null);
    if (stock) {
      companyName = stock.companyName;
      sector = stock.sector;
      industry = stock.industry;
    }
  } catch {
    /* keep nulls */
  }

  const meta = buildStockSeoMeta(sym, companyName, intent);
  const needHolders = intent === "overview" || intent === "institutional-ownership" || intent === "13f";
  const needInsiders = intent === "overview" || intent === "insider-trading";

  const [holdersResult, insidersResult] = await Promise.all([
    needHolders
      ? withTimeout(
          getTopHolders(getPool(), sym, { limit: HOLDER_LIMIT }).then((r) => ({
            holders: (r.holders || []).slice(0, HOLDER_LIMIT),
            quarter: r.meta?.currentQuarter || null,
          })),
          DATA_TIMEOUT_MS,
          { holders: [] as FundHoldingAggregate[], quarter: null as string | null }
        )
      : Promise.resolve({ holders: [] as FundHoldingAggregate[], quarter: null as string | null }),
    needInsiders
      ? withTimeout(
          (async () => {
            const high = await getInsiderTransactions(sym, {
              limit: INSIDER_LIMIT,
              signal: "high",
              sort: "date",
            });
            if (high.transactions?.length) {
              return high.transactions.slice(0, INSIDER_LIMIT);
            }
            const any = await getInsiderTransactions(sym, {
              limit: INSIDER_LIMIT,
              sort: "date",
            });
            return (any.transactions || []).slice(0, INSIDER_LIMIT);
          })(),
          DATA_TIMEOUT_MS,
          [] as InsiderTransactionRow[]
        )
      : Promise.resolve([] as InsiderTransactionRow[]),
  ]);

  return {
    ticker: sym,
    companyName,
    sector,
    industry,
    holders: holdersResult.holders,
    holdersQuarter: holdersResult.quarter,
    insiders: insidersResult,
    canonicalPath: meta.canonicalPath,
    title: meta.title,
    description: meta.description,
    h1: meta.h1,
    intent: meta.intent,
  };
}

function renderHoldersTable(data: StockPageSsrData): string {
  if (!data.holders.length) {
    return `<p>No institutional holder rows available yet for ${escapeHtml(data.ticker)}.</p>`;
  }
  const quarterNote = data.holdersQuarter
    ? ` <span>(${escapeHtml(data.holdersQuarter)})</span>`
    : "";
  const rows = data.holders
    .map((h) => {
      const name = escapeHtml(h.fundName || "—");
      const cik = h.filerCik ? String(h.filerCik).replace(/^0+/, "") : "";
      const nameCell = cik
        ? `<a href="/institution/${escapeHtml(cik)}">${name}</a>`
        : name;
      return `<tr>
  <td>${nameCell}</td>
  <td>${escapeHtml(formatShares(h.shares))}</td>
  <td>${escapeHtml(formatUsd(h.valueUsd))}</td>
  <td>${escapeHtml(formatPct(h.pctOutstanding))}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>Top institutional holders${quarterNote}</h2>
<table>
  <thead><tr><th>Institution</th><th>Shares</th><th>Value</th><th>% Outstanding</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

function renderInsidersTable(data: StockPageSsrData): string {
  if (!data.insiders.length) {
    return `<p>No recent open-market insider transactions available yet for ${escapeHtml(data.ticker)}.</p>`;
  }
  const rows = data.insiders
    .map((t) => {
      const date = escapeHtml(t.transactionDate || t.filingDate || "—");
      const name = escapeHtml(t.insiderName || "—");
      const title = escapeHtml(t.insiderTitle || "—");
      const code = escapeHtml(codeLabel(t.transactionCode));
      const value = escapeHtml(formatUsd(t.transactionValue));
      return `<tr>
  <td>${date}</td>
  <td>${name}</td>
  <td>${title}</td>
  <td>${code}</td>
  <td>${value}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>Recent insider transactions</h2>
<table>
  <thead><tr><th>Date</th><th>Insider</th><th>Title</th><th>Type</th><th>Value</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

export function renderStockPageSsrBody(data: StockPageSsrData): string {
  const sym = escapeHtml(data.ticker);
  const name = data.companyName ? escapeHtml(data.companyName) : null;
  const sectorBits = [data.sector, data.industry].filter(Boolean).map((s) => escapeHtml(String(s)));
  const h1 = escapeHtml(data.h1);

  let blurb: string;
  let tables: string;
  if (data.intent === "insider-trading") {
    blurb = name
      ? `Open-market and disclosed Form 4 insider trading for ${name} (${sym}) on InvestAtlant.`
      : `Open-market and disclosed Form 4 insider trading for ${sym} on InvestAtlant.`;
    tables = renderInsidersTable(data);
  } else if (data.intent === "institutional-ownership" || data.intent === "13f") {
    blurb = name
      ? `Institutional ownership and 13F holdings context for ${name} (${sym}) on InvestAtlant.`
      : `Institutional ownership and 13F holdings context for ${sym} on InvestAtlant.`;
    tables = renderHoldersTable(data);
  } else if (data.intent === "sec-filings") {
    blurb = name
      ? `SEC filings research for ${name} (${sym}) on InvestAtlant — open the interactive filings tab for the full list.`
      : `SEC filings research for ${sym} on InvestAtlant — open the interactive filings tab for the full list.`;
    tables = `<p>Interactive SEC filing history loads in the app for ${sym}. Related research:</p>
<ul>
  <li><a href="${escapeHtml(stockSeoPath(data.ticker, "insider-activity"))}">${sym} insider trading</a></li>
  <li><a href="${escapeHtml(stockSeoPath(data.ticker, "ownership"))}">${sym} institutional ownership</a></li>
</ul>`;
  } else {
    blurb = name
      ? `${name} (${sym}) stock research on InvestAtlant: institutional ownership from 13F filings, insider Form 4 activity, and SEC context.`
      : `${sym} stock research on InvestAtlant: institutional ownership from 13F filings, insider Form 4 activity, and SEC context.`;
    tables = `${renderHoldersTable(data)}\n${renderInsidersTable(data)}`;
  }

  return `<section id="seo-stock-ssr" class="seo-stock-ssr" data-ticker="${sym}" data-intent="${escapeHtml(data.intent)}">
  <article>
    <h1>${h1}</h1>
    ${sectorBits.length ? `<p>${sectorBits.join(" · ")}</p>` : ""}
    <p>${blurb}</p>
    <nav aria-label="Stock sections">
      <a href="${escapeHtml(stockSeoPath(data.ticker))}">Overview</a> ·
      <a href="${escapeHtml(stockSeoPath(data.ticker, "insider-activity"))}">Insider trading</a> ·
      <a href="${escapeHtml(stockSeoPath(data.ticker, "ownership"))}">Institutional ownership</a> ·
      <a href="${escapeHtml(stockSeoPath(data.ticker, "sec-filings"))}">SEC filings</a>
    </nav>
    ${tables}
  </article>
</section>`;
}

function renderJsonLd(data: StockPageSsrData): string {
  const payload = {
    "@context": "https://schema.org",
    "@type": "Corporation",
    name: data.companyName || data.ticker,
    tickerSymbol: data.ticker,
    url: `${SITE_ORIGIN}${data.canonicalPath}`,
    description: data.description,
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

export function injectStockPageSsr(indexHtml: string, data: StockPageSsrData): string {
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

  // Fill the visible SPA stock header so crawlers (and first paint) match the URL
  // even if they ignore the clipped #seo-stock-ssr block.
  const displayName = data.companyName?.trim() || data.ticker;
  html = html.replace(
    /(<h2[^>]*id="active-symbol-label"[^>]*>)([^<]*)(<\/h2>)/i,
    `$1${escapeHtml(data.ticker)}$3`
  );
  html = html.replace(
    /(<p[^>]*id="active-name-label"[^>]*>)([^<]*)(<\/p>)/i,
    `$1${escapeHtml(displayName)}$3`
  );

  const bodyBlock = `${renderJsonLd(data)}\n${renderStockPageSsrBody(data)}`;
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${bodyBlock}\n`);
  }

  // Clip for humans as soon as head sets data-boot=app (same as hub SSR).
  // Content stays in the DOM for crawlers; waiting for data-ready caused a
  // multi-second flash of SEO tables when opening stock links (e.g. from X).
  if (!html.includes('html[data-boot="app"] #seo-stock-ssr')) {
    html = html.replace(
      "</style>",
      `html[data-boot="app"] #seo-stock-ssr {
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

export async function renderStockPageHtml(
  ticker: string,
  intent: StockSsrIntent = "overview"
): Promise<string> {
  const data = await loadStockPageSsrData(ticker, intent);
  const indexHtml = readIndexHtml();
  return injectStockPageSsr(indexHtml, data);
}

export async function tryHandleStockPageSsr(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const ticker = parseStockTickerFromPath(url.pathname);
  if (!ticker) return false;
  const intent = parseStockSsrIntent(url.pathname);

  try {
    const html = await renderStockPageHtml(ticker, intent);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
    });
    res.end(html);
  } catch (err) {
    console.warn(
      "[seo-stock-ssr] Falling back to plain index.html:",
      err instanceof Error ? err.message : err
    );
    return false;
  }

  return true;
}
