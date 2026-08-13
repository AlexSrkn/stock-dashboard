import { downloadSecSubmissionsByTicker } from "../submissions.js";
import { secFetchText, secThrottle, type SecFetchOptions } from "../http.js";
import { edgarDocumentUrl } from "../thirteenF/filingIndex.js";
import { withRetry } from "../retry.js";
import {
  ensureInsiderTransactionsSchema,
  insertInsiderTransactions,
  toInsiderInsert,
} from "../../db/insiderTransactions.js";
import { invalidateRepeatBuyersCache } from "../../insider/repeatBuyers/cache.js";
import { invalidateInsiderSentimentCache } from "../../insider/sentiment/cache.js";
import { invalidateFirstTimeBuyersCache } from "../../insider/firstTimeBuyers/cache.js";
import { invalidateHeavySellingCache } from "../../insider/heavySelling/cache.js";
import { discoverForm4Filings } from "./discover.js";
import { findForm4OwnershipDocument } from "./findDocument.js";
import { parseForm4Xml } from "./parseForm4.js";
import { formatSecCik } from "../http.js";

export interface IngestForm4Options extends SecFetchOptions {
  ticker: string;
  limit?: number;
  /** Only ingest Form 4 filings with filingDate strictly after this YYYY-MM-DD. */
  sinceDate?: string | null;
  ensureSchema?: boolean;
}

export interface IngestForm4Result {
  ticker: string;
  cik: string;
  filingsProcessed: number;
  transactionsInserted: number;
  transactionsSkipped: number;
  errors: string[];
}

export async function ingestForm4ForTicker(
  options: IngestForm4Options
): Promise<IngestForm4Result> {
  const ticker = String(options.ticker).trim().toUpperCase();
  const sinceDate = String(options.sinceDate || "").trim() || null;
  const limit = Math.max(1, options.limit ?? (sinceDate ? 120 : 40));

  if (options.ensureSchema !== false) {
    await ensureInsiderTransactionsSchema();
  }

  const { ticker: _t, limit: _l, ensureSchema: _e, sinceDate: _s, ...fetchOpts } = options;
  const submissions = await downloadSecSubmissionsByTicker({ ticker, ...fetchOpts });
  const cik = formatSecCik(submissions.cik);
  const filings = discoverForm4Filings(submissions, { limit, sinceDate });

  let transactionsInserted = 0;
  let transactionsSkipped = 0;
  const errors: string[] = [];
  let filingsProcessed = 0;

  for (const filing of filings) {
    try {
      const docName = await findForm4OwnershipDocument(filing, options);
      const url = edgarDocumentUrl(filing, docName);
      await secThrottle();
      const xml = await withRetry(() => secFetchText(url, options));
      const parsed = parseForm4Xml(xml, filing.filingDate || null);
      const effectiveTicker = (parsed.issuerTicker || ticker).toUpperCase();

      const inserts = parsed.transactions.map((tx) =>
        toInsiderInsert(cik, effectiveTicker, filing.accessionNumber, tx)
      );

      const { inserted, skipped } = await insertInsiderTransactions(inserts);
      transactionsInserted += inserted;
      transactionsSkipped += skipped;
      filingsProcessed++;
    } catch (e) {
      errors.push(
        `${filing.accessionNumber}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (transactionsInserted > 0) {
    invalidateRepeatBuyersCache();
    invalidateInsiderSentimentCache();
    invalidateFirstTimeBuyersCache();
    invalidateHeavySellingCache();
  }

  return {
    ticker,
    cik,
    filingsProcessed,
    transactionsInserted,
    transactionsSkipped,
    errors,
  };
}
