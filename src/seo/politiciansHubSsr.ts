/**
 * Server-side HTML for politician hubs (/politicians/trades, /politicians/most-accumulated)
 * so crawlers see keyword-rich titles + Congress PTR tables without executing the SPA.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type http from "node:http";
import { readPoliticiansRecent } from "../politicians/recent.js";
import { getPoliticianMostAccumulated } from "../politicians/analytics/service.js";
import type { PoliticianTrade } from "../politicians/types.js";
import type { PoliticianMostAccumulatedRow } from "../politicians/analytics/types.js";
import { SITE_ORIGIN } from "./sitemap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const INDEX_PATH = path.join(ROOT, "index.html");

const DATA_TIMEOUT_MS = 2500;
const ROW_LIMIT = 15;

export type PoliticiansHubKind = "trades" | "most-accumulated";

export type PoliticiansHubSsrData = {
  kind: PoliticiansHubKind;
  canonicalPath: string;
  title: string;
  description: string;
  trades: PoliticianTrade[];
  accumulated: PoliticianMostAccumulatedRow[];
  accumulatedPeriodLabel: string | null;
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

export function parsePoliticiansHubKind(pathname: string): PoliticiansHubKind | null {
  const p = normalizePath(pathname);
  if (p === "/politicians" || p === "/politicians/trades") return "trades";
  if (p === "/politicians/most-accumulated") return "most-accumulated";
  return null;
}

export function buildPoliticiansHubSeoMeta(kind: PoliticiansHubKind): {
  title: string;
  description: string;
  canonicalPath: string;
} {
  if (kind === "most-accumulated") {
    return {
      title: "Congress Stock Buys — Most Accumulated by Politicians | InvestAtlant",
      description:
        "See stocks most accumulated by members of Congress from publicly disclosed PTR filings on InvestAtlant.",
      canonicalPath: "/politicians/most-accumulated",
    };
  }
  return {
    title: "Congress Trading — Recent Politician Stock Trades | InvestAtlant",
    description:
      "Follow recent congressional stock trades disclosed under the STOCK Act (House and Senate PTR filings) on InvestAtlant.",
    canonicalPath: "/politicians/trades",
  };
}

function flattenRecentTrades(): PoliticianTrade[] {
  const payload = readPoliticiansRecent();
  if (!payload) return [];
  const out: PoliticianTrade[] = [];
  for (const bundle of [...(payload.house || []), ...(payload.senate || [])]) {
    for (const trade of bundle.trades || []) {
      out.push({
        ...trade,
        politicianName: trade.politicianName || bundle.politicianName,
        politicianKey: trade.politicianKey || bundle.politicianKey,
        chamber: trade.chamber || bundle.chamber,
        party: trade.party ?? bundle.party,
      });
    }
  }
  out.sort((a, b) => {
    const da = String(a.transactionDate || a.filingDate || "");
    const db = String(b.transactionDate || b.filingDate || "");
    return db.localeCompare(da);
  });
  return out.slice(0, ROW_LIMIT);
}

export async function loadPoliticiansHubSsrData(
  kind: PoliticiansHubKind
): Promise<PoliticiansHubSsrData> {
  const meta = buildPoliticiansHubSeoMeta(kind);

  if (kind === "most-accumulated") {
    const result = await withTimeout(
      Promise.resolve().then(() => {
        const payload = getPoliticianMostAccumulated("quarter", "all");
        return {
          rows: (payload.stocks || []).slice(0, ROW_LIMIT),
          label: payload.periodLabel || payload.period || null,
        };
      }),
      DATA_TIMEOUT_MS,
      { rows: [] as PoliticianMostAccumulatedRow[], label: null as string | null }
    );
    return {
      kind,
      ...meta,
      trades: [],
      accumulated: result.rows,
      accumulatedPeriodLabel: result.label,
    };
  }

  const trades = await withTimeout(
    Promise.resolve().then(() => flattenRecentTrades()),
    DATA_TIMEOUT_MS,
    [] as PoliticianTrade[]
  );

  return {
    kind,
    ...meta,
    trades,
    accumulated: [],
    accumulatedPeriodLabel: null,
  };
}

function stockLink(ticker: string | null | undefined): string {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) return "—";
  return `<a href="/stock/${escapeHtml(encodeURIComponent(sym))}">${escapeHtml(sym)}</a>`;
}

function politicianLink(name: string, key: string | undefined): string {
  const label = escapeHtml(name || "—");
  if (!key) return label;
  return `<a href="/politicians/${escapeHtml(encodeURIComponent(key))}">${label}</a>`;
}

function renderTradesTable(rows: PoliticianTrade[]): string {
  if (!rows.length) {
    return `<p>No recent congressional trades available yet. Run the politicians fetch job on the server.</p>`;
  }
  const body = rows
    .map((t) => {
      const date = escapeHtml(t.transactionDate || t.filingDate || "—");
      const chamber = escapeHtml(String(t.chamber || "—"));
      const type = escapeHtml(t.transactionCategory || t.transactionType || "—");
      const amount = escapeHtml(t.amountRange || "—");
      const asset = escapeHtml(t.assetName || "—");
      return `<tr>
  <td>${date}</td>
  <td>${politicianLink(t.politicianName, t.politicianKey)}</td>
  <td>${chamber}</td>
  <td>${stockLink(t.ticker)}</td>
  <td>${asset}</td>
  <td>${type}</td>
  <td>${amount}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>Recent Congress trades</h2>
<table>
  <thead><tr><th>Date</th><th>Politician</th><th>Chamber</th><th>Stock</th><th>Asset</th><th>Type</th><th>Amount</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

function renderAccumulatedTable(
  rows: PoliticianMostAccumulatedRow[],
  periodLabel: string | null
): string {
  if (!rows.length) {
    return `<p>No politician accumulation rows available yet.</p>`;
  }
  const note = periodLabel ? ` <span>(${escapeHtml(periodLabel)})</span>` : "";
  const body = rows
    .map((r) => {
      const label = escapeHtml(r.assetLabel || "—");
      const buyers = escapeHtml(String(r.politiciansBuying ?? "—"));
      const net = escapeHtml(formatUsd(r.netAmountUsd));
      const trades = escapeHtml(String(r.tradeCount ?? "—"));
      return `<tr>
  <td>${stockLink(r.ticker)}</td>
  <td>${label}</td>
  <td>${buyers}</td>
  <td>${net}</td>
  <td>${trades}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>Most accumulated stocks by Congress${note}</h2>
<table>
  <thead><tr><th>Stock</th><th>Asset</th><th>Politicians buying</th><th>Net amount</th><th>Trades</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

export function renderPoliticiansHubSsrBody(data: PoliticiansHubSsrData): string {
  const isAccum = data.kind === "most-accumulated";
  const h1 = isAccum ? "Congress Stock Buys" : "Congress Trading";
  const blurb = isAccum
    ? "Stocks most accumulated by members of Congress from publicly disclosed Periodic Transaction Reports (PTRs)."
    : "Recent stock trades by members of Congress disclosed under the STOCK Act — House and Senate PTR filings.";

  return `<section id="seo-politicians-ssr" class="seo-politicians-ssr" data-hub="${escapeHtml(data.kind)}">
  <article>
    <h1>${h1}</h1>
    <p>${blurb}</p>
    <nav aria-label="Politician hubs">
      <a href="/politicians/trades">Recent trades</a> ·
      <a href="/politicians/most-accumulated">Most accumulated</a> ·
      <a href="/politicians/largest-portfolios">Largest portfolios</a> ·
      <a href="/politicians/sector-exposure">Sector exposure</a>
    </nav>
    ${
      isAccum
        ? renderAccumulatedTable(data.accumulated, data.accumulatedPeriodLabel)
        : renderTradesTable(data.trades)
    }
  </article>
</section>`;
}

function renderJsonLd(data: PoliticiansHubSsrData): string {
  const payload = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: data.title,
    description: data.description,
    url: `${SITE_ORIGIN}${data.canonicalPath}`,
    isPartOf: { "@type": "WebSite", name: "InvestAtlant", url: SITE_ORIGIN },
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

export function injectPoliticiansHubSsr(indexHtml: string, data: PoliticiansHubSsrData): string {
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

  const bodyBlock = `${renderJsonLd(data)}\n${renderPoliticiansHubSsrBody(data)}`;
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${bodyBlock}\n`);
  }

  if (!html.includes('html[data-boot="app"] #seo-politicians-ssr')) {
    html = html.replace(
      "</style>",
      `html[data-boot="app"] #seo-politicians-ssr {
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

export async function renderPoliticiansHubHtml(kind: PoliticiansHubKind): Promise<string> {
  const data = await loadPoliticiansHubSsrData(kind);
  return injectPoliticiansHubSsr(readIndexHtml(), data);
}

export async function tryHandlePoliticiansHubSsr(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const kind = parsePoliticiansHubKind(url.pathname);
  if (!kind) return false;

  try {
    const html = await renderPoliticiansHubHtml(kind);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
    });
    res.end(html);
  } catch (err) {
    console.warn(
      "[seo-politicians-ssr] Falling back to plain index.html:",
      err instanceof Error ? err.message : err
    );
    return false;
  }

  return true;
}
