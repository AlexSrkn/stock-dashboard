/**
 * Bulk-ingest SEC fundamentals into sec_financial_period for stock hub rankings.
 *
 * Reuses getFilingsFundamentals() — same path as Filings → Fundamentals in the UI.
 *
 * Usage:
 *   npm run stocks:warm-fundamentals
 *   npm run stocks:warm-fundamentals -- --limit 50
 *   npm run stocks:warm-fundamentals -- --from 100 --limit 100
 *   npm run stocks:warm-fundamentals -- --ticker AAPL,MSFT
 *   npm run stocks:warm-fundamentals -- --skip-existing
 *   npm run stocks:warm-fundamentals -- --all-tickers --limit 200
 *
 * Default universe: S&P 500 (~503 tickers). Requires DATABASE_URL and SEC_USER_AGENT in .env.
 */
import fs from "node:fs";
import { closePool, getDatabaseUrl, loadEnvFile } from "../src/db/pool.js";
import { resolveSecUserAgent } from "../src/sec/http.js";
import { loadAllSecCompanyTickers } from "../src/sec/submissions.js";
import {
  ingestFundamentalsForTickers,
  loadSp500Tickers,
  normalizeTickerList,
} from "../src/stocks/fundamentalsBulkIngest.js";

loadEnvFile();

const DEFAULT_DELAY_MS = 250;
const TICKER_RE = /^[A-Z][A-Z0-9.\-^=]{0,14}$/;

function parseArgs(argv: string[]) {
  let from = 0;
  let limit: number | null = null;
  let tickersCsv: string | null = null;
  let symbolsFile: string | null = null;
  let delayMs = DEFAULT_DELAY_MS;
  let skipExisting = false;
  let force = false;
  let allTickers = false;
  let sp500 = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from" && argv[i + 1]) {
      from = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Number(argv[++i]) || 1);
    } else if (arg === "--delay" && argv[i + 1]) {
      delayMs = Math.max(0, Number(argv[++i]) || DEFAULT_DELAY_MS);
    } else if (arg === "--ticker" && argv[i + 1]) {
      tickersCsv = String(argv[++i]);
      sp500 = false;
    } else if (arg === "--symbols-file" && argv[i + 1]) {
      symbolsFile = String(argv[++i]).trim();
      sp500 = false;
    } else if (arg === "--skip-existing") {
      skipExisting = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--all-tickers") {
      allTickers = true;
      sp500 = false;
    } else if (arg === "--sp500") {
      sp500 = true;
      allTickers = false;
    }
  }

  return { from, limit, tickersCsv, symbolsFile, delayMs, skipExisting, force, allTickers, sp500 };
}

function loadTickersFromFile(filePath: string): string[] {
  const text = fs.readFileSync(filePath, "utf8");
  return normalizeTickerList(
    text
      .split(/\r?\n/)
      .map((line) => line.split("#")[0].trim())
  );
}

function filterSecTicker(ticker: string): boolean {
  if (!TICKER_RE.test(ticker)) return false;
  if (ticker.includes(".")) return false;
  if (ticker.length > 5) return false;
  return true;
}

async function resolveTickerList(options: ReturnType<typeof parseArgs>): Promise<string[]> {
  if (options.tickersCsv) {
    return normalizeTickerList(options.tickersCsv.split(/[,\s]+/));
  }
  if (options.symbolsFile) {
    return loadTickersFromFile(options.symbolsFile);
  }
  if (options.allTickers) {
    console.log("Loading SEC company_tickers.json…");
    const entries = await loadAllSecCompanyTickers();
    const tickers = entries.map((e) => e.ticker).filter(filterSecTicker);
    console.log(`Universe: ${tickers.length} common SEC tickers`);
    return tickers;
  }
  const tickers = loadSp500Tickers();
  console.log(`Universe: S&P 500 (${tickers.length} tickers)`);
  return tickers;
}

async function main() {
  getDatabaseUrl();
  const userAgent = resolveSecUserAgent();
  if (userAgent.includes("set SEC_USER_AGENT")) {
    throw new Error("Set SEC_USER_AGENT in .env before bulk SEC ingestion.");
  }

  const opts = parseArgs(process.argv.slice(2));
  let tickers = await resolveTickerList(opts);
  tickers = tickers.slice(opts.from, opts.limit != null ? opts.from + opts.limit : undefined);

  if (!tickers.length) {
    console.log("No tickers in selected range (check --from / --limit).");
    return;
  }

  console.log(
    `Ingesting SEC fundamentals for ${tickers.length} ticker(s)` +
      (opts.skipExisting && !opts.force ? " (skipping already stored)" : "") +
      ` · delay ${opts.delayMs}ms`
  );
  if (opts.from > 0 || opts.limit != null) {
    console.log(`Batch: from=${opts.from} count=${tickers.length}`);
  }

  const started = Date.now();
  const result = await ingestFundamentalsForTickers({
    tickers,
    delayMs: opts.delayMs,
    skipExisting: opts.skipExisting,
    force: opts.force,
    onProgress: ({ index, total, ticker, status, quarterlyPeriods, annualPeriods, error }) => {
      if (status === "skipped") {
        process.stdout.write(`[${index}/${total}] ${ticker}… skipped (already in DB)\n`);
        return;
      }
      if (status === "ok") {
        process.stdout.write(
          `[${index}/${total}] ${ticker}… ok (${quarterlyPeriods ?? 0}Q, ${annualPeriods ?? 0}Y)\n`
        );
        return;
      }
      process.stdout.write(`[${index}/${total}] ${ticker}… failed: ${error}\n`);
    },
  });

  const elapsedMin = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `\nDone in ${elapsedMin} min: ${result.succeeded} ingested, ${result.skipped} skipped, ${result.failed} failed` +
      ` (${result.attempted} attempted).`
  );

  if (result.failures.length) {
    console.log("Failures (first 25):");
    for (const row of result.failures.slice(0, 25)) {
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
