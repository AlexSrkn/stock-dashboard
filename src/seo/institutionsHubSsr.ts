/**
 * Server-side HTML for institution hubs (/institutions, /institutions/most-accumulated)
 * so crawlers see keyword-rich titles + 13F tables without executing the SPA.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type http from "node:http";
import { listTrackedInstitutions } from "../institution/institutionAnalytics.js";
import { getMostAccumulatedPeriod } from "../institution/mostAccumulated/service.js";
import type { MostAccumulatedRow } from "../institution/mostAccumulated/types.js";
import { reloadTrackedInstitutions } from "../ownership/trackedInstitutions.js";
import { SITE_ORIGIN } from "./sitemap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const INDEX_PATH = path.join(ROOT, "index.html");

const DATA_TIMEOUT_MS = 2500;
const ROW_LIMIT = 15;

export type InstitutionsHubKind = "directory" | "most-accumulated";

export type InstitutionDirectoryRow = {
  name: string;
  cik: string;
  type: string | null;
};

export type InstitutionsHubSsrData = {
  kind: InstitutionsHubKind;
  canonicalPath: string;
  title: string;
  description: string;
  institutions: InstitutionDirectoryRow[];
  accumulated: MostAccumulatedRow[];
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

function formatShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Math.round(Number(n)).toLocaleString("en-US");
}

function bareCik(cik: string): string {
  return String(cik || "").replace(/\D/g, "").replace(/^0+/, "") || "0";
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

export function parseInstitutionsHubKind(pathname: string): InstitutionsHubKind | null {
  const p = normalizePath(pathname);
  if (p === "/institutions") return "directory";
  if (p === "/institutions/most-accumulated") return "most-accumulated";
  return null;
}

export function buildInstitutionsHubSeoMeta(kind: InstitutionsHubKind): {
  title: string;
  description: string;
  canonicalPath: string;
} {
  if (kind === "most-accumulated") {
    return {
      title: "Institutional Buying — Most Accumulated Stocks | InvestAtlant",
      description:
        "See stocks with the most institutional buying from 13F filings — net shares added by tracked funds on InvestAtlant.",
      canonicalPath: "/institutions/most-accumulated",
    };
  }
  return {
    title: "Institutional Investors — 13F Holdings Directory | InvestAtlant",
    description:
      "Browse tracked institutional investors and their 13F holdings, activity, and portfolio history on InvestAtlant.",
    canonicalPath: "/institutions",
  };
}

export async function loadInstitutionsHubSsrData(
  kind: InstitutionsHubKind
): Promise<InstitutionsHubSsrData> {
  const meta = buildInstitutionsHubSeoMeta(kind);

  if (kind === "most-accumulated") {
    const result = await withTimeout(
      getMostAccumulatedPeriod("quarter")
        .then((payload) => ({
          rows: (payload.stocks || []).slice(0, ROW_LIMIT),
          label: payload.periodLabel || payload.currentPeriod || null,
        }))
        .catch(() => ({ rows: [] as MostAccumulatedRow[], label: null as string | null })),
      DATA_TIMEOUT_MS,
      { rows: [] as MostAccumulatedRow[], label: null as string | null }
    );
    return {
      kind,
      ...meta,
      institutions: [],
      accumulated: result.rows,
      accumulatedPeriodLabel: result.label,
    };
  }

  try {
    reloadTrackedInstitutions();
  } catch {
    /* keep seed list */
  }
  const institutions = listTrackedInstitutions()
    .slice(0, ROW_LIMIT)
    .map((f) => ({
      name: f.name,
      cik: f.cik,
      type: f.type ? String(f.type) : null,
    }));

  return {
    kind,
    ...meta,
    institutions,
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

function renderDirectoryTable(rows: InstitutionDirectoryRow[]): string {
  if (!rows.length) {
    return `<p>No tracked institutional investors available yet.</p>`;
  }
  const body = rows
    .map((r) => {
      const cik = bareCik(r.cik);
      const name = escapeHtml(r.name || "—");
      const type = escapeHtml(r.type || "—");
      const link = cik && cik !== "0" ? `<a href="/institution/${escapeHtml(cik)}">${name}</a>` : name;
      return `<tr>
  <td>${link}</td>
  <td>${type}</td>
  <td>${escapeHtml(cik)}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>Tracked institutional investors</h2>
<table>
  <thead><tr><th>Institution</th><th>Type</th><th>CIK</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

function renderAccumulatedTable(rows: MostAccumulatedRow[], periodLabel: string | null): string {
  if (!rows.length) {
    return `<p>No institutional accumulation rows available yet. Warm the most-accumulated cache on the server.</p>`;
  }
  const note = periodLabel ? ` <span>(${escapeHtml(periodLabel)})</span>` : "";
  const body = rows
    .map((r) => {
      const company = escapeHtml(r.companyName || "—");
      const sector = escapeHtml(r.sector || "—");
      const buyers = escapeHtml(String(r.institutionsBuying ?? "—"));
      const shares = escapeHtml(formatShares(r.netSharesAdded));
      const value = escapeHtml(formatUsd(r.reportedValueUsd));
      return `<tr>
  <td>${stockLink(r.ticker)}</td>
  <td>${company}</td>
  <td>${sector}</td>
  <td>${buyers}</td>
  <td>${shares}</td>
  <td>${value}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>Most institutionally accumulated stocks${note}</h2>
<table>
  <thead><tr><th>Stock</th><th>Company</th><th>Sector</th><th>Institutions buying</th><th>Net shares</th><th>Value</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

export function renderInstitutionsHubSsrBody(data: InstitutionsHubSsrData): string {
  const isAccum = data.kind === "most-accumulated";
  const h1 = isAccum ? "Institutional Buying" : "Institutional Investors";
  const blurb = isAccum
    ? "Stocks with the strongest institutional buying from 13F filings — where tracked funds added the most shares."
    : "Directory of tracked institutional investors (13F filers) with holdings, activity, and portfolio history on InvestAtlant.";

  return `<section id="seo-institutions-ssr" class="seo-institutions-ssr" data-hub="${escapeHtml(data.kind)}">
  <article>
    <h1>${h1}</h1>
    <p>${blurb}</p>
    <nav aria-label="Institution hubs">
      <a href="/institutions">All institutions</a> ·
      <a href="/institutions/most-accumulated">Most accumulated</a> ·
      <a href="/institutions/notable-investors">Notable Investors</a> ·
      <a href="/institutions/new-positions">New positions</a>
    </nav>
    ${
      isAccum
        ? renderAccumulatedTable(data.accumulated, data.accumulatedPeriodLabel)
        : renderDirectoryTable(data.institutions)
    }
  </article>
</section>`;
}

function renderJsonLd(data: InstitutionsHubSsrData): string {
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

export function injectInstitutionsHubSsr(
  indexHtml: string,
  data: InstitutionsHubSsrData
): string {
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

  const bodyBlock = `${renderJsonLd(data)}\n${renderInstitutionsHubSsrBody(data)}`;
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${bodyBlock}\n`);
  }

  if (!html.includes("#seo-institutions-ssr")) {
    html = html.replace(
      "</style>",
      `#seo-institutions-ssr {
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

export async function renderInstitutionsHubHtml(kind: InstitutionsHubKind): Promise<string> {
  const data = await loadInstitutionsHubSsrData(kind);
  return injectInstitutionsHubSsr(readIndexHtml(), data);
}

export async function tryHandleInstitutionsHubSsr(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const kind = parseInstitutionsHubKind(url.pathname);
  if (!kind) return false;

  try {
    const html = await renderInstitutionsHubHtml(kind);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
    });
    res.end(html);
  } catch (err) {
    console.warn(
      "[seo-institutions-ssr] Falling back to plain index.html:",
      err instanceof Error ? err.message : err
    );
    return false;
  }

  return true;
}
