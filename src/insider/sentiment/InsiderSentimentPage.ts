import type { InsiderSentimentPayload } from "./types.js";
import {
  formatSentimentScore,
  mapSentimentRowsForUi,
  sentimentLabelClass,
  type InsiderSentimentTableProps,
} from "./InsiderSentimentTable.js";

/**
 * Presentational page contract for Insider Sentiment.
 * Mounted in the Insiders hub via `app.js` (`#insider-sentiment-hub`).
 */
export interface InsiderSentimentPageProps extends InsiderSentimentTableProps {
  loading?: boolean;
  emptyMessage?: string;
}

export function insiderSentimentPageTitle(): string {
  return "Insider Sentiment";
}

export function insiderSentimentPageSubtitle(): string {
  return "Stock-level open-market Form 4 buying vs selling — net flow, buyer ratio, and sentiment score.";
}

export function summarizeSentimentForCards(payload: InsiderSentimentPayload | null) {
  const s = payload?.summary;
  return {
    bullish: s ? String(s.mostBullishStocks) : "—",
    bearish: s ? String(s.mostBearishStocks) : "—",
    netBuying: s?.netInsiderBuying ?? null,
    average: s ? formatSentimentScore(s.averageSentimentScore) : "—",
  };
}

export { formatSentimentScore, mapSentimentRowsForUi, sentimentLabelClass };
