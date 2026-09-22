import type { InsiderTransactionRow } from "../db/insiderTransactions.js";
import { normalizeTicker } from "../politicians/byTicker.js";
import type { PoliticianTrade } from "../politicians/types.js";
import { readPoliticiansRecent } from "../politicians/recent.js";

export type TradeSource = "politician" | "insider";
export type TradeSide = "buy" | "sell";

export interface XTradeDraft {
  id: string;
  source: TradeSource;
  personName: string;
  personDetail: string | null;
  side: TradeSide;
  ticker: string;
  tradeDate: string | null;
  amountLabel: string | null;
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
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function formatPoliticianAmount(trade: PoliticianTrade): string | null {
  const range = String(trade.amountRange || "").trim();
  if (range) return range;
  if (trade.amountMin != null && trade.amountMax != null) {
    return `${formatUsdCompact(trade.amountMin)}–${formatUsdCompact(trade.amountMax)}`;
  }
  if (trade.amountMin != null) return formatUsdCompact(trade.amountMin);
  if (trade.amountMax != null) return formatUsdCompact(trade.amountMax);
  return null;
}

function formatInsiderAmount(row: InsiderTransactionRow): string | null {
  if (row.transactionValue != null && Number.isFinite(row.transactionValue) && row.transactionValue > 0) {
    return formatUsdCompact(row.transactionValue);
  }
  if (
    row.shares != null &&
    row.pricePerShare != null &&
    Number.isFinite(row.shares) &&
    Number.isFinite(row.pricePerShare)
  ) {
    return formatUsdCompact(row.shares * row.pricePerShare);
  }
  return null;
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

export function formatTradePost(input: {
  source: TradeSource;
  personName: string;
  personDetail?: string | null;
  side: TradeSide;
  ticker: string;
  amountLabel?: string | null;
  stockUrl: string;
}): string {
  const verb = input.side === "buy" ? "bought" : "sold";
  const label = input.source === "politician" ? "Politician" : "Insider";
  const detail =
    input.source === "insider" && input.personDetail
      ? ` (${input.personDetail})`
      : "";
  const amount = input.amountLabel ? ` (${input.amountLabel})` : "";
  return `${label} ${input.personName}${detail} ${verb} $${input.ticker}${amount}.\n${input.stockUrl}`;
}

function tradeSortDate(iso: string | null | undefined): string {
  return String(iso || "").slice(0, 10);
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
  seen: Set<string>
): XTradeDraft[] {
  const payload = readPoliticiansRecent();
  if (!payload) return [];

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
        tradeSortDate(trade.transactionDate) ||
        tradeSortDate(trade.filingDate) ||
        tradeSortDate(bundle.filingDate) ||
        null;
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
      const text = formatTradePost({
        source: "politician",
        personName,
        side,
        ticker,
        amountLabel,
        stockUrl: url,
      });

      upsertDraft(map, {
        id,
        source: "politician",
        personName,
        personDetail: trade.party || bundle.party || null,
        side,
        ticker,
        tradeDate,
        amountLabel,
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
      tradeSortDate(row.transactionDate) || tradeSortDate(row.filingDate) || null;
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
    const amountLabel = formatInsiderAmount(row);
    const text = formatTradePost({
      source: "insider",
      personName,
      personDetail: title,
      side,
      ticker,
      amountLabel,
      stockUrl: url,
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
      stockUrl: url,
      text,
      charCount: text.length,
    });
  }

  return [...map.values()];
}

function sortDraftsNewest(drafts: XTradeDraft[]): XTradeDraft[] {
  return [...drafts].sort((a, b) => {
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

  const politicians =
    source === "all" || source === "politicians"
      ? sortDraftsNewest(collectPoliticianDrafts(baseUrl, seen))
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
    lines.push(`- date: ${d.tradeDate || "unknown"}`);
    lines.push(`- id: \`${d.id}\``);
    lines.push(``);
  });

  return lines.join("\n");
}
