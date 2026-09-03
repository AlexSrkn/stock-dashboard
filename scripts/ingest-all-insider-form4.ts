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
 *   npx tsx scripts/ingest-all-insider-form4.ts --since-db --existing-only
 *   npx tsx scripts/ingest-all-insider-form4.ts --since 2026-06-03 --existing-only
 *
 * Default universe: all tickers in SEC company_tickers.json (~10k+). Use --limit to batch.
 */
import fs from "node:fs";
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { ingestForm4ForTicker } from "../src/sec/form4/ingestForm4.js";
import { loadAllSecCompanyTickers } from "../src/sec/submissions.js";

loadEnvFile();

const SEC_DELAY_MS = 250;
const DEFAULT_FILING_LIMIT = 20;
const TICKER_RE = /^[A-Z][A-Z0-9.\-^=]{0,14}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  let sinceDate: string | null = null;
  let sinceDb = false;
  let existingOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from" && argv[i + 1]) {
      from = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Number(argv[++i]) || 1);
    } else if (arg === "--filings" && argv[i + 1]) {
      filingLimit = Math.max(1, Math.min(200, Number(argv[++i]) || DEFAULT_FILING_LIMIT));
    } else if (arg === "--delay" && argv[i + 1]) {
      delayMs = Math.max(0, Number(argv[++i]) || SEC_DELAY_MS);
    } else if (arg === "--ticker" && argv[i + 1]) {
      singleTicker = String(argv[++i]).trim().toUpperCase();
    } else if (arg === "--symbols-file" && argv[i + 1]) {
      symbolsFile = String(argv[++i]).trim();
    } else if (arg === "--since" && argv[i + 1]) {
      sinceDate = String(argv[++i]).trim();
    } else if (arg === "--since-db") {
      sinceDb = true;
    } else if (arg === "--existing-only") {
      existingOnly = true;
    } else if (arg === "--all-tickers") {
      includeAllTickers = true;
    }
  }

  return {
    from,
    limit,
    singleTicker,
    symbolsFile,
    filingLimit,
    delayMs,
    includeAllTickers,
    sinceDate,
    sinceDb,
    existingOnly,
  };
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

async function loadExistingTickers(): Promise<string[]> {
  const pool = getPool();
  const res = await pool.query<{ ticker: string }>(`
    SELECT DISTINCT UPPER(BTRIM(ticker)) AS ticker
    FROM insider_transaction
    WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''
    ORDER BY 1
  `);
  return res.rows.map((r) => r.ticker).filter((t) => TICKER_RE.test(t));
}

async function loadMaxFilingDate(): Promise<string | null> {
  const pool = getPool();
  const res = await pool.query<{ max_filing: string | null }>(`
    SELECT MAX(filing_date)::text AS max_filing
    FROM insider_transaction
    WHERE filing_date IS NOT NULL
  `);
  return res.rows[0]?.max_filing ?? null;
}

async function resolveTickerList(options: ReturnType<typeof parseArgs>): Promise<string[]> {
  if (options.singleTicker) {
    return [options.singleTicker];
  }
  if (options.symbolsFile) {
    return loadTickersFromFile(options.symbolsFile);
  }
  if (options.existingOnly) {
    console.log("Loading tickers already present in insider_transaction…");
    const tickers = await loadExistingTickers();
    console.log(`Universe: ${tickers.length} existing tickers`);
    return tickers;
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

async function resolveSinceDate(options: ReturnType<typeof parseArgs>): Promise<string | null> {
  if (options.sinceDate) {
    if (!ISO_DATE_RE.test(options.sinceDate)) {
      throw new Error(`Invalid --since date (expected YYYY-MM-DD): ${options.sinceDate}`);
    }
    return options.sinceDate;
  }
  if (options.sinceDb) {
    const maxFiling = await loadMaxFilingDate();
    if (!maxFiling) {
      console.log("No filing_date in DB yet — ingesting without a since filter.");
      return null;
    }
    console.log(`Using DB max filing_date as since watermark: ${maxFiling} (exclusive)`);
    return maxFiling;
  }
  return null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sinceDate = await resolveSinceDate(opts);
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

  const filingLimit = sinceDate ? Math.max(opts.filingLimit, 80) : opts.filingLimit;

  console.log(
    sinceDate
      ? `Incremental Form 4 ingest since ${sinceDate} (exclusive) for ${tickers.length} ticker(s); up to ${filingLimit} new filing(s) each…`
      : `Ingesting last ${filingLimit} Form 4 filing(s) per issuer for ${tickers.length} ticker(s)…`
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
  let totalFilings = 0;
  let tickersWithNew = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    process.stdout.write(`[${i + 1}/${tickers.length}] ${ticker}… `);

    try {
      const result = await ingestForm4ForTicker({
        ticker,
        limit: filingLimit,
        sinceDate,
        ensureSchema: !schemaReady,
      });
      schemaReady = true;
      totalInserted += result.transactionsInserted;
      totalFilings += result.filingsProcessed;
      if (result.transactionsInserted > 0) tickersWithNew += 1;
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
  console.log(
    `\nDone: ${ok} succeeded, ${failed} failed, ${totalFilings} filings processed, ${totalInserted} transactions inserted (${tickersWithNew} tickers with new rows).`
  );
  if (failed) {
    console.log("Failures (first 20):");
    for (const row of summary.filter((s) => !s.ok).slice(0, 20)) {
      console.log(`  - ${row.ticker}: ${row.error}`);
    }
    // Nightly incremental runs often hit a few SEC/network errors; don't fail the whole job
    // unless most tickers failed or nothing succeeded.
    const failRate = failed / summary.length;
    if (ok === 0 || failRate > 0.25) {
      process.exitCode = 1;
    } else {
      console.log(
        `Treating as success (${failed}/${summary.length} ticker failures ≤ 25%).`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
