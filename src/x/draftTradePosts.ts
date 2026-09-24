import type { InsiderTransactionRow } from "../db/insiderTransactions.js";
import { normalizeTicker } from "../politicians/byTicker.js";
import { parseUsDateToIso } from "../politicians/normalize.js";
import type { PoliticianTrade } from "../politicians/types.js";
import { readPoliticiansRecent } from "../politicians/recent.js";

export type TradeSource = "politician" | "insider" | "institutional";
export type TradeSide = "buy" | "sell";

/** Skip politician trades whose transaction date is older than this (days). */
export const DEFAULT_POLITICIAN_MAX_TRADE_AGE_DAYS = 90;

/** Insider trades at/above this USD get a 🚨 flag. */
export const INTERESTING_INSIDER_USD = 250_000;
/** Politician trades at/above this (range max / mid) get a 🚨 flag. */
export const INTERESTING_POLITICIAN_USD = 50_000;

export interface XTradeDraft {
  id: string;
  source: TradeSource;
  personName: string;
  personDetail: string | null;
  side: TradeSide;
  ticker: string;
  tradeDate: string | null;
  /** Disclosure / PTR filing date (ISO), when known. */
  filingDate?: string | null;
  amountLabel: string | null;
  /** True when size/role warrants a 🚨 callout. */
  interesting?: boolean;
  stockUrl: string;
  text: string;
  charCount: number;
}

export interface CollectDraftsOptions {
  baseUrl: string;
  limit?: number;
  source?: "all" | "politicians" | "insiders";
  insiderRows?: InsiderTransactionRow[];
  /** Existing draft ids to skip (dedupe across runs). */
  seenIds?: Iterable<string>;
  /**
   * Politician only: drop trades with transactionDate older than N days.
   * Matches what looks “recent” on /politicians (trade date column). Default 90.
   * Set 0 to disable.
   */
  maxPoliticianTradeAgeDays?: number;
  /** Clock override for age filtering (tests). */
  now?: Date;
}

function normalizeBaseUrl(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\/+$/, "");
}

export function stockUrl(baseUrl: string, ticker: string): string {
  return `${normalizeBaseUrl(baseUrl)}/stock/${encodeURIComponent(ticker)}`;
}

function isPlausibleTicker(raw: string | null | undefined): string | null {
  const t = normalizeTicker(String(raw || ""));
  if (!t) return null;
  // Allow common equity tickers: 1–5 letters, optional class suffix like BRK.B
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(t)) return null;
  return t;
}

function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function formatPoliticianAmount(trade: PoliticianTrade): string | null {
  if (trade.amountMin != null && trade.amountMax != null && trade.amountMin !== trade.amountMax) {
    return `${formatUsdCompact(trade.amountMin)}–${formatUsdCompact(trade.amountMax)}`;
  }
  const range = String(trade.amountRange || "").trim();
  if (range) return range.replace(/\s+/g, " ");
  if (trade.amountMin != null) return formatUsdCompact(trade.amountMin);
  if (trade.amountMax != null) return formatUsdCompact(trade.amountMax);
  return null;
}

function insiderAmountUsd(row: InsiderTransactionRow): number | null {
  if (row.transactionValue != null && Number.isFinite(row.transactionValue) && row.transactionValue > 0) {
    return row.transactionValue;
  }
  if (
    row.shares != null &&
    row.pricePerShare != null &&
    Number.isFinite(row.shares) &&
    Number.isFinite(row.pricePerShare)
  ) {
    return row.shares * row.pricePerShare;
  }
  return null;
}

function politicianAmountUsd(trade: PoliticianTrade): number | null {
  if (trade.amountMax != null && Number.isFinite(trade.amountMax)) return trade.amountMax;
  if (trade.amountMin != null && Number.isFinite(trade.amountMin)) return trade.amountMin;
  return null;
}

function isInterestingInsider(row: InsiderTransactionRow, amountUsd: number | null): boolean {
  if (amountUsd != null && amountUsd >= INTERESTING_INSIDER_USD) return true;
  const title = String(row.insiderTitle || "").toLowerCase();
  if (!title) return false;
  const senior =
    /\b(ceo|chief executive|cfo|chief financial|coo|chairman|chairwoman|president)\b/.test(
      title
    );
  return Boolean(senior && amountUsd != null && amountUsd >= 100_000);
}

function isInterestingPolitician(amountUsd: number | null): boolean {
  return amountUsd != null && amountUsd >= INTERESTING_POLITICIAN_USD;
}

function insiderSide(row: InsiderTransactionRow): TradeSide | null {
  const code = String(row.transactionCode || "").trim().toUpperCase();
  if (code === "P") return "buy";
  if (code === "S") return "sell";
  const ad = String(row.acquisitionDisposition || "").trim().toUpperCase();
  if (ad === "A") return "buy";
  if (ad === "D") return "sell";
  return null;
}

export function draftId(parts: {
  source: TradeSource;
  personName: string;
  ticker: string;
  side: TradeSide;
  tradeDate: string | null;
}): string {
  const name = parts.personName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const date = parts.tradeDate || "unknown";
  return `${parts.source}|${name}|${parts.ticker}|${parts.side}|${date}`;
}

export function sourceEmoji(source: TradeSource, side: TradeSide): string {
  if (source === "insider") return side === "buy" ? "🟢" : "🔴";
  if (source === "politician") return "🏛️";
  return "🏦";
}

export function headlineLabel(source: TradeSource, side: TradeSide): string {
  const action = side === "buy" ? "Buy" : "Sale";
  if (source === "insider") return `Insider ${action}`;
  if (source === "politician") return `Politician ${action}`;
  return `Institutional ${action}`;
}

function ctaLine(source: TradeSource): string {
  if (source === "insider") return "Full transaction & insider history ↓";
  if (source === "politician") return "Full filing & politician trade history ↓";
  return "Full institutional ownership ↓";
}

/** Format amount for the post body (`~$395K` for point estimates, ranges as-is). */
function amountPhrase(amountLabel: string | null | undefined, approximate: boolean): string | null {
  const raw = String(amountLabel || "").trim();
  if (!raw) return null;
  if (approximate && !raw.includes("–") && !raw.includes("-") && !raw.startsWith("~")) {
    return `~${raw}`;
  }
  return raw;
}

export function formatTradePost(input: {
  source: TradeSource;
  personName: string;
  personDetail?: string | null;
  side: TradeSide;
  ticker: string;
  amountLabel?: string | null;
  stockUrl: string;
  interesting?: boolean;
}): string {
  const verb = input.side === "buy" ? "bought" : "sold";
  const emoji = sourceEmoji(input.source, input.side);
  const prefix = input.interesting ? `🚨 ${emoji}` : emoji;
  const headline = headlineLabel(input.source, input.side);
  const detail =
    input.source === "insider" && input.personDetail
      ? ` (${input.personDetail})`
      : "";
  const amount = amountPhrase(
    input.amountLabel,
    input.source === "insider"
  );
  const amountBit = amount ? ` ${amount}` : "";
  const line1 = `${prefix} ${headline}: ${input.personName}${detail} ${verb}${amountBit} of $${input.ticker}.`;
  return `${line1}\n\n${ctaLine(input.source)}\n${input.stockUrl}`;
}

/** Normalize MM/DD/YYYY or ISO to YYYY-MM-DD for sorting / age checks. */
export function toDraftIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return parseUsDateToIso(raw);
}

function daysBetweenIso(iso: string, now: Date): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((nowUtc - ms) / 86_400_000);
}

function isWithinMaxAge(
  iso: string | null,
  maxAgeDays: number,
  now: Date
): boolean {
  if (maxAgeDays <= 0) return true;
  if (!iso) return false;
  const age = daysBetweenIso(iso, now);
  return age >= 0 && age <= maxAgeDays;
}

function amountSortKey(label: string | null): number {
  if (!label) return 0;
  const m = label.match(/([\d.]+)\s*([kKmMbB])?/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const u = (m[2] || "").toUpperCase();
  if (u === "B") return n * 1_000_000_000;
  if (u === "M") return n * 1_000_000;
  if (u === "K") return n * 1_000;
  return n;
}

/** Keep one draft per id; prefer larger disclosed amount. */
function upsertDraft(map: Map<string, XTradeDraft>, draft: XTradeDraft): void {
  const prev = map.get(draft.id);
  if (!prev || amountSortKey(draft.amountLabel) > amountSortKey(prev.amountLabel)) {
    map.set(draft.id, draft);
  }
}

export function collectPoliticianDrafts(
  baseUrl: string,
  seen: Set<string>,
  options?: {
    maxTradeAgeDays?: number;
    now?: Date;
  }
): XTradeDraft[] {
  const payload = readPoliticiansRecent();
  if (!payload) return [];

  const maxAge =
    options?.maxTradeAgeDays ?? DEFAULT_POLITICIAN_MAX_TRADE_AGE_DAYS;
  const now = options?.now ?? new Date();
  const map = new Map<string, XTradeDraft>();
  const bundles = [...payload.house, ...payload.senate];

  for (const bundle of bundles) {
    const personName = String(bundle.politicianName || "").trim();
    if (!personName) continue;

    for (const trade of bundle.trades) {
      if (trade.transactionCategory !== "buy" && trade.transactionCategory !== "sell") continue;
      const ticker = isPlausibleTicker(trade.ticker);
      if (!ticker) continue;

      const side = trade.transactionCategory;
      const tradeDate =
        toDraftIsoDate(trade.transactionDate) ||
        toDraftIsoDate(trade.filingDate) ||
        toDraftIsoDate(bundle.filingDate) ||
        null;
      const filingDate =
        toDraftIsoDate(trade.filingDate) || toDraftIsoDate(bundle.filingDate) || null;

      // Prefer transaction date for freshness; fall back to filing if tx missing.
      const ageDate = toDraftIsoDate(trade.transactionDate) || filingDate;
      if (!isWithinMaxAge(ageDate, maxAge, now)) continue;

      const id = draftId({
        source: "politician",
        personName,
        ticker,
        side,
        tradeDate,
      });
      if (seen.has(id)) continue;

      const url = stockUrl(baseUrl, ticker);
      const amountLabel = formatPoliticianAmount(trade);
      const interesting = isInterestingPolitician(politicianAmountUsd(trade));
      const text = formatTradePost({
        source: "politician",
        personName,
        side,
        ticker,
        amountLabel,
        stockUrl: url,
        interesting,
      });

      upsertDraft(map, {
        id,
        source: "politician",
        personName,
        personDetail: trade.party || bundle.party || null,
        side,
        ticker,
        tradeDate,
        filingDate,
        amountLabel,
        interesting,
        stockUrl: url,
        text,
        charCount: text.length,
      });
    }
  }

  return [...map.values()];
}

export function collectInsiderDrafts(
  baseUrl: string,
  rows: InsiderTransactionRow[],
  seen: Set<string>
): XTradeDraft[] {
  const map = new Map<string, XTradeDraft>();

  for (const row of rows) {
    const side = insiderSide(row);
    if (!side) continue;
    if (row.isDerivative) continue;

    const ticker = isPlausibleTicker(row.ticker);
    if (!ticker) continue;

    const personName = String(row.insiderName || "").trim();
    if (!personName) continue;

    const tradeDate =
      toDraftIsoDate(row.transactionDate) || toDraftIsoDate(row.filingDate) || null;
    const id = draftId({
      source: "insider",
      personName,
      ticker,
      side,
      tradeDate,
    });
    if (seen.has(id)) continue;

    const title = String(row.insiderTitle || "").trim() || null;
    const url = stockUrl(baseUrl, ticker);
    const amountUsd = insiderAmountUsd(row);
    const amountLabel = amountUsd != null ? formatUsdCompact(amountUsd) : null;
    const interesting = isInterestingInsider(row, amountUsd);
    const text = formatTradePost({
      source: "insider",
      personName,
      personDetail: title,
      side,
      ticker,
      amountLabel,
      stockUrl: url,
      interesting,
    });

    upsertDraft(map, {
      id,
      source: "insider",
      personName,
      personDetail: title,
      side,
      ticker,
      tradeDate,
      amountLabel,
      interesting,
      stockUrl: url,
      text,
      charCount: text.length,
    });
  }

  return [...map.values()];
}

function sortDraftsNewest(drafts: XTradeDraft[]): XTradeDraft[] {
  return [...drafts].sort((a, b) => {
    // Politicians: prefer disclosure date (matches /politicians default), then trade date.
    if (a.source === "politician" || b.source === "politician") {
      const af = a.filingDate || a.tradeDate || "";
      const bf = b.filingDate || b.tradeDate || "";
      if (af !== bf) return bf.localeCompare(af);
    }
    const ad = a.tradeDate || "";
    const bd = b.tradeDate || "";
    if (ad !== bd) return bd.localeCompare(ad);
    return a.id.localeCompare(b.id);
  });
}

export function collectTradeDrafts(options: CollectDraftsOptions): {
  drafts: XTradeDraft[];
  warnings: string[];
} {
  const baseUrl = normalizeBaseUrl(options.baseUrl) || "https://investatlant.com";
  const limit = Math.max(1, Math.min(100, options.limit ?? 10));
  const source = options.source ?? "all";
  const seen = new Set(options.seenIds ?? []);
  const warnings: string[] = [];
  const maxPoliticianTradeAgeDays =
    options.maxPoliticianTradeAgeDays ?? DEFAULT_POLITICIAN_MAX_TRADE_AGE_DAYS;
  const now = options.now ?? new Date();

  const politicians =
    source === "all" || source === "politicians"
      ? sortDraftsNewest(
          collectPoliticianDrafts(baseUrl, seen, {
            maxTradeAgeDays: maxPoliticianTradeAgeDays,
            now,
          })
        )
      : [];
  const insiders =
    source === "all" || source === "insiders"
      ? options.insiderRows
        ? sortDraftsNewest(collectInsiderDrafts(baseUrl, options.insiderRows, seen))
        : []
      : [];

  if ((source === "all" || source === "insiders") && !options.insiderRows) {
    if (source === "insiders") warnings.push("No insider rows provided.");
  }

  let drafts: XTradeDraft[];
  if (source === "politicians") {
    drafts = politicians.slice(0, limit);
  } else if (source === "insiders") {
    drafts = insiders.slice(0, limit);
  } else {
    // Balanced mix so newer insider floods don't hide politician drafts.
    const polTake = Math.ceil(limit / 2);
    const insTake = Math.floor(limit / 2);
    const picked = [...politicians.slice(0, polTake), ...insiders.slice(0, insTake)];
    if (picked.length < limit) {
      const used = new Set(picked.map((d) => d.id));
      for (const d of [...politicians, ...insiders]) {
        if (picked.length >= limit) break;
        if (used.has(d.id)) continue;
        used.add(d.id);
        picked.push(d);
      }
    }
    drafts = sortDraftsNewest(picked).slice(0, limit);
  }

  return { drafts, warnings };
}

export function draftsToMarkdown(drafts: XTradeDraft[], generatedAt: string): string {
  const lines: string[] = [
    `# X trade drafts`,
    ``,
    `Generated: ${generatedAt}`,
    `Count: ${drafts.length}`,
    ``,
  ];

  drafts.forEach((d, i) => {
    lines.push(`## ${i + 1}. ${d.source} - ${d.personName} - $${d.ticker} - ${d.side}`);
    lines.push(``);
    lines.push("```");
    lines.push(d.text);
    lines.push("```");
    lines.push(``);
    lines.push(`- chars: ${d.charCount}`);
    if (d.interesting) lines.push(`- flag: interesting`);
    lines.push(`- traded: ${d.tradeDate || "unknown"}`);
    if (d.source === "politician" && d.filingDate) {
      lines.push(`- filed: ${d.filingDate}`);
    }
    lines.push(`- id: \`${d.id}\``);
    lines.push(``);
  });

  return lines.join("\n");
}
