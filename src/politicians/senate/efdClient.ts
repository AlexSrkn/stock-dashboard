import { politicianFetch } from "../http.js";
import type { PoliticianTrade } from "../types.js";
import {
  cleanPoliticianTicker,
  mapTransactionCategory,
  parseAmountRange,
  parseUsDateToIso,
} from "../normalize.js";
import {
  buildAcknowledgementBody,
  cookieHeader,
  csrfHeader,
  extractCsrfToken,
  extractFormAction,
  isAcknowledgementGate,
  storeSetCookies,
} from "../acknowledgementGate.js";
import { normalizeSenatePtrUrl, parseSenatePtrUrl } from "./urls.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const EFD_ORIGIN = "https://efdsearch.senate.gov";
const EFD_HOME = `${EFD_ORIGIN}/search/home/`;
const EFD_SEARCH = `${EFD_ORIGIN}/search/`;
const EFD_DATA = `${EFD_ORIGIN}/search/report/data/`;

export interface SenateSearchRow {
  firstName: string;
  lastName: string;
  office: string;
  reportType: string;
  reportDate: string;
  reportUrl: string;
  reportId: string;
}

export interface SenateSearchOptions {
  fromDate?: string;
  toDate?: string;
  firstName?: string;
  lastName?: string;
  limit?: number;
  /** When set, only return this many rows from a single page (no pagination). */
  pageSize?: number;
  /** Skip paper/scanned filings that link to /view/paper/ instead of /view/ptr/. */
  htmlOnly?: boolean;
}

const SEARCH_PAGE_SIZE = 100;

function formatSubmittedDate(date: string | undefined, endOfDay = false): string {
  if (!date) return "";
  const trimmed = date.trim();
  if (/\d{2}:\d{2}:\d{2}/.test(trimmed)) return trimmed;
  return endOfDay ? `${trimmed} 23:59:59` : `${trimmed} 00:00:00`;
}

function buildSearchBody(
  csrf: string,
  options: SenateSearchOptions & { start?: number; length?: number }
): URLSearchParams {
  return new URLSearchParams({
    draw: "1",
    start: String(options.start ?? 0),
    length: String(options.length ?? options.pageSize ?? options.limit ?? SEARCH_PAGE_SIZE),
    "search[value]": "",
    "search[regex]": "false",
    report_types: "[11]",
    filer_types: "[1]",
    submitted_start_date: formatSubmittedDate(options.fromDate ?? "01/01/2012"),
    submitted_end_date: formatSubmittedDate(options.toDate, true),
    candidate_state: "",
    senator_state: "",
    office_id: "",
    first_name: options.firstName ?? "",
    last_name: options.lastName ?? "",
    csrfmiddlewaretoken: csrf,
  });
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSenateSearchRows(payload: unknown, htmlOnly = false): SenateSearchRow[] {
  const data = payload as { data?: unknown[] };
  if (!Array.isArray(data.data)) return [];
  return data.data
    .map((row) => {
      const cells = row as string[];
      if (!Array.isArray(cells) || cells.length < 5) return null;
      const reportHtml = cells[3] ?? "";
      const hrefMatch = reportHtml.match(/href=['"]([^'"]+)['"]/i);
      const href = hrefMatch?.[1] ?? "";
      if (htmlOnly && !/\/view\/ptr\//i.test(href)) return null;
      const reportIdMatch =
        href.match(/\/ptr\/([a-f0-9-]+)\/?$/i) ??
        href.match(/\/paper\/([a-f0-9-]+)\/?$/i) ??
        href.match(/\/(\d+)\/?$/);
      const reportTypeMatch = reportHtml.match(/>([^<]+)</);
      return {
        firstName: stripTags(cells[0] ?? ""),
        lastName: stripTags(cells[1] ?? ""),
        office: stripTags(cells[2] ?? ""),
        reportType: reportTypeMatch?.[1]?.trim() ?? "Periodic Transaction Report",
        reportDate: stripTags(cells[4] ?? ""),
        reportUrl: href.startsWith("http") ? href : `${EFD_ORIGIN}${href}`,
        reportId: reportIdMatch?.[1] ?? "",
      };
    })
    .filter((r): r is SenateSearchRow => Boolean(r?.reportUrl));
}

function parseSenatePoliticianName(html: string): string {
  const block = html.match(/<h2[^>]*class=['"]filedReport['"][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  if (!block) return "Unknown";
  const text = stripTags(block);
  const paren = text.match(/\(([^,]+),\s*([^)]+)\)/);
  if (paren) return `${paren[2].trim()} ${paren[1].trim()}`;
  return text.replace(/^The Honorable\s+/i, "").replace(/\s+/g, " ").trim() || "Unknown";
}

function extractPtrPageMeta(html: string, sourceUrl: string) {
  const parsed = parseSenatePtrUrl(sourceUrl);
  return {
    politicianName: parseSenatePoliticianName(html),
    filingDate: html.match(/Filed\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null,
    filingId: parsed?.reportId ?? sourceUrl,
    sourceUrl: parsed?.sourceUrl ?? normalizeSenatePtrUrl(sourceUrl),
  };
}

function parseTransactionTableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]));
    if (!cells.length) continue;
    if (cells.some((c) => /transaction date/i.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

function parseSenatePtrHtml(
  html: string,
  meta: { politicianName: string; filingDate: string | null; filingId: string; sourceUrl: string }
): PoliticianTrade[] {
  if (isAcknowledgementGate(html)) return [];
  const trades: PoliticianTrade[] = [];

  for (const cells of parseTransactionTableRows(html)) {
    let transactionDate: string;
    let owner: string;
    let ticker: string | null;
    let assetName: string;
    let assetType: string | null;
    let typeCell: string;
    let amountCell: string;
    let comment: string;

    if (cells.length >= 9) {
      transactionDate = cells[1] ?? "";
      owner = cells[2] ?? "";
      ticker = cleanPoliticianTicker(cells[3]);
      assetName = cells[4] ?? "";
      assetType = cells[5] || null;
      typeCell = cells[6] ?? "";
      amountCell = cells[7] ?? "";
      comment = cells[8] ?? "";
    } else if (cells.length >= 6) {
      [transactionDate, owner, assetName, typeCell, amountCell, comment] = cells;
      ticker = cleanPoliticianTicker(assetName.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/)?.[1]);
      assetType = null;
    } else {
      continue;
    }

    if (!assetName || !typeCell || !/^\d{2}\/\d{2}\/\d{4}/.test(transactionDate)) continue;

    // When eFD leaves ticker blank ("--"), recover a symbol from the asset name if present.
    if (!ticker) {
      ticker = cleanPoliticianTicker(assetName.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/)?.[1]);
    }

    const amountRange = amountCell && amountCell !== "--" ? amountCell : null;
    const { min: amountMin, max: amountMax } = parseAmountRange(amountRange);

    trades.push({
      chamber: "senate",
      politicianName: meta.politicianName,
      state: undefined,
      district: undefined,
      owner: owner || undefined,
      assetName,
      ticker,
      assetType,
      transactionType: typeCell,
      transactionCategory: mapTransactionCategory(typeCell),
      transactionDate: parseUsDateToIso(transactionDate),
      notificationDate: null,
      amountRange,
      amountMin,
      amountMax,
      capitalGainsOver200: null,
      filingDate: meta.filingDate,
      filingId: meta.filingId,
      sourceUrl: meta.sourceUrl,
      comment: comment && comment !== "--" ? comment : null,
    });
  }

  return trades;
}

export class SenateEfdClient {
  private jar = new Map<string, string>();
  private sessionReady = false;

  private baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      ...extra,
    };
    const cookies = cookieHeader(this.jar);
    if (cookies) headers.Cookie = cookies;
    const csrf = csrfHeader(this.jar);
    if (csrf) headers["X-CSRFToken"] = csrf;
    return headers;
  }

  private async fetchHtml(url: string, init: RequestInit = {}): Promise<{ res: Response; html: string }> {
    const res = await politicianFetch(
      url,
      { ...init, headers: this.baseHeaders(init.headers as Record<string, string>) },
      { delayMs: 0 }
    );
    storeSetCookies(this.jar, res);
    const html = await res.text();
    return { res, html };
  }

  private async submitAcknowledgementGate(html: string, pageUrl: string): Promise<string> {
    const action = extractFormAction(html, pageUrl);
    const body = buildAcknowledgementBody(html);
    let res = await politicianFetch(
      action,
      {
        method: "POST",
        headers: this.baseHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: pageUrl,
          Origin: EFD_ORIGIN,
        }),
        body,
        redirect: "manual",
      },
      { delayMs: 0 }
    );
    storeSetCookies(this.jar, res);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        const nextUrl = loc.startsWith("http") ? loc : new URL(loc, EFD_ORIGIN).toString();
        res = await politicianFetch(
          nextUrl,
          { headers: this.baseHeaders({ Referer: pageUrl }) },
          { delayMs: 0 }
        );
        storeSetCookies(this.jar, res);
        return res.text();
      }
    }

    const nextHtml = await res.text();
    if (!res.ok) {
      throw new Error(`Senate eFD acknowledgement failed (${res.status}) at ${action}`);
    }
    return nextHtml;
  }

  private async passGateIfNeeded(html: string, pageUrl: string): Promise<string> {
    if (!isAcknowledgementGate(html)) return html;
    return this.submitAcknowledgementGate(html, pageUrl);
  }

  /** Accept the Senate eFD interstitial terms gate and warm search session cookies. */
  async ensureSession(): Promise<void> {
    if (this.sessionReady) return;

    let { html } = await this.fetchHtml(EFD_HOME);
    html = await this.passGateIfNeeded(html, EFD_HOME);

    if (isAcknowledgementGate(html)) {
      throw new Error("Senate eFD: still on acknowledgement gate after home submission");
    }

    ({ html } = await this.fetchHtml(EFD_SEARCH, {
      headers: { Referer: EFD_HOME },
    }));
    html = await this.passGateIfNeeded(html, EFD_SEARCH);

    if (isAcknowledgementGate(html)) {
      throw new Error("Senate eFD: search page blocked by acknowledgement gate");
    }

    if (!extractCsrfToken(html) && !csrfHeader(this.jar)) {
      throw new Error("Senate eFD: no CSRF token after session setup");
    }

    this.sessionReady = true;
  }

  private async authedHtml(url: string, init: RequestInit = {}): Promise<string> {
    await this.ensureSession();
    let { res, html } = await this.fetchHtml(url, init);
    if (isAcknowledgementGate(html)) {
      this.sessionReady = false;
      await this.ensureSession();
      ({ res, html } = await this.fetchHtml(url, init));
    }
    if (isAcknowledgementGate(html)) {
      throw new Error(`Senate eFD: acknowledgement gate blocked ${url}`);
    }
    if (!res.ok) {
      throw new Error(`Senate eFD request failed (${res.status}) for ${url}`);
    }
    return html;
  }

  private async searchPtrPage(
    csrf: string,
    options: SenateSearchOptions & { start: number; length: number }
  ): Promise<{ rows: SenateSearchRow[]; recordsTotal: number }> {
    const body = buildSearchBody(csrf, options);

    const res = await politicianFetch(
      EFD_DATA,
      {
        method: "POST",
        headers: this.baseHeaders({
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: EFD_SEARCH,
          Origin: EFD_ORIGIN,
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": csrf,
        }),
        body,
      },
      { delayMs: 400 }
    );
    storeSetCookies(this.jar, res);

    const raw = await res.text();
    if (isAcknowledgementGate(raw)) {
      this.sessionReady = false;
      await this.ensureSession();
      const searchHtml = await this.authedHtml(EFD_SEARCH, { headers: { Referer: EFD_HOME } });
      const nextCsrf = extractCsrfToken(searchHtml) ?? csrfHeader(this.jar);
      if (!nextCsrf) throw new Error("Senate eFD: missing CSRF after gate refresh");
      return this.searchPtrPage(nextCsrf, options);
    }
    if (!res.ok) {
      const isMaintenance = /site under maintenance|under maintenance/i.test(raw);
      throw new Error(
        `Senate eFD search failed (${res.status})${isMaintenance ? " — site under maintenance" : ""}: ${raw.slice(0, 180)}`
      );
    }

    let payload: { data?: unknown[]; recordsTotal?: number };
    try {
      payload = JSON.parse(raw) as { data?: unknown[]; recordsTotal?: number };
    } catch {
      throw new Error(`Senate eFD search returned non-JSON: ${raw.slice(0, 180)}`);
    }

    return {
      rows: parseSenateSearchRows(payload, options.htmlOnly ?? false),
      recordsTotal: payload.recordsTotal ?? 0,
    };
  }

  async searchPtrFilings(options: SenateSearchOptions = {}): Promise<SenateSearchRow[]> {
    const searchHtml = await this.authedHtml(EFD_SEARCH, { headers: { Referer: EFD_HOME } });
    const csrf = extractCsrfToken(searchHtml) ?? csrfHeader(this.jar);
    if (!csrf) throw new Error("Senate eFD: missing CSRF for search");

    const pageSize = options.pageSize ?? options.limit ?? SEARCH_PAGE_SIZE;
    const { rows } = await this.searchPtrPage(csrf, {
      ...options,
      start: 0,
      length: pageSize,
    });
    return options.limit ? rows.slice(0, options.limit) : rows;
  }

  /** Paginate the Senate PTR catalog (senators only, report type 11). */
  async listAllPtrFilings(options: SenateSearchOptions = {}): Promise<SenateSearchRow[]> {
    const searchHtml = await this.authedHtml(EFD_SEARCH, { headers: { Referer: EFD_HOME } });
    const csrf = extractCsrfToken(searchHtml) ?? csrfHeader(this.jar);
    if (!csrf) throw new Error("Senate eFD: missing CSRF for search");

    const pageSize = SEARCH_PAGE_SIZE;
    const all: SenateSearchRow[] = [];
    let start = 0;
    let recordsTotal = Infinity;

    while (start < recordsTotal) {
      const { rows, recordsTotal: total } = await this.searchPtrPage(csrf, {
        ...options,
        htmlOnly: options.htmlOnly ?? true,
        start,
        length: pageSize,
      });
      recordsTotal = total;
      all.push(...rows);
      if (!rows.length) break;
      start += pageSize;
      if (options.limit && all.length >= options.limit) break;
    }

    return options.limit ? all.slice(0, options.limit) : all;
  }

  async fetchPtrTrades(row: SenateSearchRow): Promise<PoliticianTrade[]> {
    const html = await this.authedHtml(row.reportUrl, { headers: { Referer: EFD_SEARCH } });
    return parseSenatePtrHtml(html, {
      politicianName: `${row.firstName} ${row.lastName}`.replace(/\s+/g, " ").trim(),
      filingDate: row.reportDate || null,
      filingId: row.reportId,
      sourceUrl: row.reportUrl,
    });
  }

  /** Fetch and parse a Senate PTR by direct view URL (works when search API is down). */
  async fetchPtrTradesFromUrl(url: string): Promise<PoliticianTrade[]> {
    const sourceUrl = normalizeSenatePtrUrl(url);
    const html = await this.authedHtml(sourceUrl, { headers: { Referer: EFD_SEARCH } });
    return parseSenatePtrHtml(html, extractPtrPageMeta(html, sourceUrl));
  }
}

export async function fetchSenatePtrTradesFromUrl(url: string): Promise<PoliticianTrade[]> {
  const client = new SenateEfdClient();
  return client.fetchPtrTradesFromUrl(url);
}
