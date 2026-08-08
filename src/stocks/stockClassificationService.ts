import { formatSecCik, secThrottle } from "../sec/http.js";
import { downloadSecSubmissionsByTicker, lookupCikFromTicker } from "../sec/submissions.js";
import { mapSicToSectorIndustry } from "./sicMapping.js";
import { getStocksRepository } from "./stocksRepository.js";

export interface ClassifyStockResult {
  ticker: string;
  ok: boolean;
  sector: string | null;
  industry: string | null;
  sic: string | null;
  sicDescription: string | null;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function classifyTickerFromSec(
  ticker: string,
  options: { delayMs?: number } = {}
): Promise<ClassifyStockResult> {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) {
    return {
      ticker: sym,
      ok: false,
      sector: null,
      industry: null,
      sic: null,
      sicDescription: null,
      error: "Missing ticker",
    };
  }

  try {
    const cik = await lookupCikFromTicker(sym);
    const submissions = await downloadSecSubmissionsByTicker({ ticker: sym });
    await secThrottle();

    const sic = submissions.sic ? String(submissions.sic).trim() : null;
    const sicDescription = submissions.sicDescription
      ? String(submissions.sicDescription).trim()
      : null;
    const { sector, industry } = mapSicToSectorIndustry(sic, sicDescription);
    const companyName = submissions.name ? String(submissions.name).trim() : null;

    await getStocksRepository().upsert({
      ticker: sym,
      companyName,
      sector,
      industry,
      sic,
      sicDescription,
      cik: formatSecCik(cik),
    });

    if (options.delayMs && options.delayMs > 0) {
      await sleep(options.delayMs);
    }

    return {
      ticker: sym,
      ok: true,
      sector,
      industry,
      sic,
      sicDescription,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      ticker: sym,
      ok: false,
      sector: null,
      industry: null,
      sic: null,
      sicDescription: null,
      error,
    };
  }
}

export async function classifyTickersFromSec(
  tickers: string[],
  options: { delayMs?: number; onProgress?: (event: { index: number; total: number; result: ClassifyStockResult }) => void } = {}
): Promise<{ succeeded: number; failed: number; results: ClassifyStockResult[] }> {
  await getStocksRepository().ensureSchema();

  const unique = [...new Set(tickers.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean))];
  const results: ClassifyStockResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i++) {
    const result = await classifyTickerFromSec(unique[i], { delayMs: options.delayMs });
    results.push(result);
    if (result.ok) succeeded++;
    else failed++;
    options.onProgress?.({ index: i + 1, total: unique.length, result });
  }

  return { succeeded, failed, results };
}
