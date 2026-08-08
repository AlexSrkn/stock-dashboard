import YahooFinance from "yahoo-finance2";

/** Shared Yahoo Finance client — suppresses noisy schema validation logs for edge-case symbols. */
let client: InstanceType<typeof YahooFinance> | null = null;

export function getYahooFinance(): InstanceType<typeof YahooFinance> {
  if (!client) {
    client = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
      validation: { logErrors: false },
    });
  }
  return client;
}

/** Use for symbols that may have incomplete meta (delisted, warrants, bad CUSIP mappings). */
export const YAHOO_SKIP_RESULT_VALIDATION = { validateResult: false } as const;

export type YahooChartQuote = {
  close?: number | null;
  date?: Date | string;
};

/** Extract daily OHLCV bars from a chart response (validated locally). */
export function chartQuotesToDailyBars(
  quotes: YahooChartQuote[] | undefined
): Array<{ date: Date; close: number }> {
  return (quotes ?? [])
    .map((q) => {
      const close = Number(q.close);
      const date = q.date instanceof Date ? q.date : new Date(String(q.date ?? ""));
      if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(date.getTime())) {
        return null;
      }
      return { date, close };
    })
    .filter((x): x is { date: Date; close: number } => x != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
