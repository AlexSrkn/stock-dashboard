/**
 * Bulk-ingest Form 4 / 4/A insider transactions for many issuers (US-listed companies).
 *
 * Mirrors `ingest-institutional-13f.ts`: resume with --from / --limit, one schema init,
 * per-symbol progress, and a summary at the end.
 *
 * Usage:
 *   npx tsx scripts/ingest-all-insider-form4.ts
 *   npx tsx scripts/ingest-all-insider-form4.ts --from 0 --limit 100
 *   npx tsx scripts/ingest-all-insider-form4.ts --ticker AAPL
 *   npx tsx scripts/ingest-all-insider-form4.ts --symbols-file watchlist.txt
 *   npx tsx scripts/ingest-all-insider-form4.ts --filings 25 --delay 300
 *
 * Default universe: all tickers in SEC company_tickers.json (~10k+). Use --limit to batch.
 */
import fs from "node:fs";
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { ingestForm4ForTicker } from "../src/sec/form4/ingestForm4.js";
import { loadAllSecCompanyTickers } from "../src/sec/submissions.js";

loadEnvFile();

const SEC_DELAY_MS = 300;
const DEFAULT_FILING_LIMIT = 20;
const TICKER_RE = /^[A-Z][A-Z0-9.\-^=]{0,14}$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]) {
  let from = 0;
  let limit: number | null = null;
  let singleTicker: string | null = null;
  let symbolsFile: string | null = null;
  let filingLimit = DEFAULT_FILING_LIMIT;
  let delayMs = SEC_DELAY_MS;
  let includeAllTickers = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from" && argv[i + 1]) {
      from = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Number(argv[++i]) || 1);
    } else if (arg === "--filings" && argv[i + 1]) {
      filingLimit = Math.max(1, Math.min(80, Number(argv[++i]) || DEFAULT_FILING_LIMIT));
    } else if (arg === "--delay" && argv[i + 1]) {
      delayMs = Math.max(0, Number(argv[++i]) || SEC_DELAY_MS);
    } else if (arg === "--ticker" && argv[i + 1]) {
      singleTicker = String(argv[++i]).trim().toUpperCase();
    } else if (arg === "--symbols-file" && argv[i + 1]) {
      symbolsFile = String(argv[++i]).trim();
    } else if (arg === "--all-tickers") {
      includeAllTickers = true;
    }
  }

  return { from, limit, singleTicker, symbolsFile, filingLimit, delayMs, includeAllTickers };
}

function loadTickersFromFile(filePath: string): string[] {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.split("#")[0].trim().toUpperCase())
    .filter((s) => TICKER_RE.test(s));
}

function filterTickerSymbol(ticker: string, includeAll: boolean): boolean {
  if (!TICKER_RE.test(ticker)) return false;
  if (includeAll) return true;
  if (ticker.includes(".")) return false;
  if (ticker.length > 5) return false;
  return true;
}

async function resolveTickerList(options: ReturnType<typeof parseArgs>): Promise<string[]> {
  if (options.singleTicker) {
    return [options.singleTicker];
  }
  if (options.symbolsFile) {
    return loadTickersFromFile(options.symbolsFile);
  }

  console.log("Loading SEC company_tickers.json…");
  const entries = await loadAllSecCompanyTickers();
  const tickers = entries
    .map((e) => e.ticker)
    .filter((t) => filterTickerSymbol(t, options.includeAllTickers));
  console.log(
    `Universe: ${tickers.length} tickers` +
      (options.includeAllTickers ? " (all SEC symbols)" : " (common equities, no dots)")
  );
  return tickers;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let tickers = await resolveTickerList(opts);

  if (!tickers.length) {
    console.log("No tickers to ingest.");
    return;
  }

  tickers = tickers.slice(opts.from, opts.limit != null ? opts.from + opts.limit : undefined);

  if (!tickers.length) {
    console.log("No tickers in selected range (check --from / --limit).");
    return;
  }

  console.log(
    `Ingesting last ${opts.filingLimit} Form 4 filing(s) per issuer for ${tickers.length} ticker(s)…`
  );
  if (opts.from > 0 || opts.limit != null) {
    console.log(`Batch: from=${opts.from} count=${tickers.length}`);
  }

  const summary: Array<{
    ticker: string;
    ok: boolean;
    filingsProcessed?: number;
    transactionsInserted?: number;
    transactionsSkipped?: number;
    errors?: number;
    error?: string;
  }> = [];

  let schemaReady = false;
  let totalInserted = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    process.stdout.write(`[${i + 1}/${tickers.length}] ${ticker}… `);

    try {
      const result = await ingestForm4ForTicker({
        ticker,
        limit: opts.filingLimit,
        ensureSchema: !schemaReady,
      });
      schemaReady = true;
      totalInserted += result.transactionsInserted;
      summary.push({
        ticker,
        ok: true,
        filingsProcessed: result.filingsProcessed,
        transactionsInserted: result.transactionsInserted,
        transactionsSkipped: result.transactionsSkipped,
        errors: result.errors.length,
      });
      const warn = result.errors.length ? `, ${result.errors.length} filing warn` : "";
      console.log(
        `ok (${result.filingsProcessed} filing(s), +${result.transactionsInserted} tx${warn})`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.push({ ticker, ok: false, error: message });
      console.log(`failed: ${message}`);
    }

    if (i < tickers.length - 1 && opts.delayMs > 0) {
      await sleep(opts.delayMs);
    }
  }

  const ok = summary.filter((s) => s.ok).length;
  const failed = summary.length - ok;
  console.log(`\nDone: ${ok} succeeded, ${failed} failed, ${totalInserted} transactions inserted.`);
  if (failed) {
    console.log("Failures (first 20):");
    for (const row of summary.filter((s) => !s.ok).slice(0, 20)) {
      console.log(`  - ${row.ticker}: ${row.error}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
