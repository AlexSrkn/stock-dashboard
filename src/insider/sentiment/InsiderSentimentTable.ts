import type { InsiderSentimentPayload, InsiderSentimentRow } from "./types.js";

/**
 * Presentational helper for Insider Sentiment.
 * Live UI is in `app.js` (vanilla).
 */
export interface InsiderSentimentTableProps {
  payload: InsiderSentimentPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
}

export function formatSentimentScore(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

export function mapSentimentRowsForUi(payload: InsiderSentimentPayload): Array<
  InsiderSentimentRow & { rank: number }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.rows.map((row, idx) => ({ ...row, rank: offset + idx + 1 }));
}

export function sentimentLabelClass(label: string): string {
  if (label === "Strong Bullish") return "insider-sentiment-label insider-sentiment-label--strong-bull";
  if (label === "Bullish") return "insider-sentiment-label insider-sentiment-label--bull";
  if (label === "Bearish") return "insider-sentiment-label insider-sentiment-label--bear";
  if (label === "Strong Bearish") return "insider-sentiment-label insider-sentiment-label--strong-bear";
  return "insider-sentiment-label insider-sentiment-label--neutral";
}
