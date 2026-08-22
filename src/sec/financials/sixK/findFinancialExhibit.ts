import type { EdgarIndexItem } from "../filingIndex.js";

export interface SixKFilingCandidate {
  documentName: string;
  score: number;
  description: string;
  type: string | null;
}

const FINANCIAL_HINTS =
  /financial\s*result|results\s*announcement|interim\s*report|half[- ]year|quarterly\s*result|press\s*release|earnings/i;

/** Rank 6-K index attachments likely to contain consolidated financial statements. */
export function rankSixKFinancialExhibits(items: EdgarIndexItem[]): SixKFilingCandidate[] {
  const out: SixKFilingCandidate[] = [];
  for (const item of items) {
    const name = String(item.name || "");
    const desc = String(item.description || "");
    const type = item.type ? String(item.type) : null;
    const lower = `${name} ${desc} ${type ?? ""}`.toLowerCase();
    if (!/\.(htm|html|xml)$/i.test(name)) continue;
    if (lower.includes("index") || lower.includes("primary_doc")) continue;

    let score = 10;
    if (/ex99|ex-99|exhibit\s*99/i.test(lower)) score = 0;
    if (FINANCIAL_HINTS.test(desc) || FINANCIAL_HINTS.test(name)) score -= 2;
    if (/financial/i.test(lower)) score -= 1;
    if (/\.xml$/i.test(name) && !/xbrl/i.test(lower)) score += 3;
    if (/cover|signature|submitted|graphic|jpg|png/i.test(lower)) score += 5;

    out.push({ documentName: name, score, description: desc, type });
  }
  return out.sort((a, b) => a.score - b.score || a.documentName.localeCompare(b.documentName));
}

export function pickBestSixKFinancialExhibit(items: EdgarIndexItem[]): SixKFilingCandidate | null {
  const ranked = rankSixKFinancialExhibits(items);
  return ranked[0] ?? null;
}
