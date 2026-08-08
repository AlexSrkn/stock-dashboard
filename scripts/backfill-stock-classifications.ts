/**
 * Backfill SIC / sector / industry for stocks from SEC submissions.
 *
 * Usage:
 *   npm run stocks:backfill-classifications
 *   npm run stocks:backfill-classifications -- --limit 50
 *   npm run stocks:backfill-classifications -- --ticker AAPL,MSFT
 *   npm run stocks:backfill-classifications -- --skip-existing
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { loadSp500Tickers } from "../src/stocks/fundamentalsBulkIngest.js";
import { classifyTickersFromSec } from "../src/stocks/stockClassificationService.js";
import { getStocksRepository } from "../src/stocks/stocksRepository.js";

loadEnvFile();

const DEFAULT_DELAY_MS = 250;

function parseArgs(argv: string[]) {
  let limit: number | null = null;
  let tickersCsv: string | null = null;
  let delayMs = DEFAULT_DELAY_MS;
  let skipExisting = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Number(argv[++i]) || 1);
    } else if (arg === "--ticker" && argv[i + 1]) {
      tickersCsv = String(argv[++i]);
    } else if (arg === "--delay" && argv[i + 1]) {
      delayMs = Math.max(0, Number(argv[++i]) || DEFAULT_DELAY_MS);
    } else if (arg === "--skip-existing") {
      skipExisting = true;
    }
  }

  return { limit, tickersCsv, delayMs, skipExisting };
}

async function resolveTickerUniverse(options: ReturnType<typeof parseArgs>): Promise<string[]> {
  if (options.tickersCsv) {
    return options.tickersCsv
      .split(/[,\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
  }

  const sp500 = loadSp500Tickers();
  const pool = getPool();
  const fromFinancials = await pool.query<{ ticker: string }>(
    `SELECT DISTINCT UPPER(BTRIM(ticker)) AS ticker
     FROM sec_financial_period
     WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''`
  );

  const seen = new Set<string>();
  const out: string[] = [];
  for (const ticker of [...sp500, ...fromFinancials.rows.map((r) => r.ticker)]) {
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await getStocksRepository().ensureSchema();

  let tickers = await resolveTickerUniverse(opts);

  if (opts.skipExisting) {
    const pool = getPool();
    const existing = await pool.query<{ ticker: string }>(
      `SELECT ticker FROM stocks WHERE sic IS NOT NULL AND sector IS NOT NULL`
    );
    const have = new Set(existing.rows.map((r) => r.ticker));
    tickers = tickers.filter((t) => !have.has(t));
  }

  if (opts.limit != null) {
    tickers = tickers.slice(0, opts.limit);
  }

  if (!tickers.length) {
    console.log("No tickers to classify.");
    return;
  }

  console.log(`Classifying ${tickers.length} ticker(s) from SEC submissions (delay ${opts.delayMs}ms)…`);

  const { succeeded, failed, results } = await classifyTickersFromSec(tickers, {
    delayMs: opts.delayMs,
    onProgress: ({ index, total, result }) => {
      if (result.ok) {
        console.log(
          `[${index}/${total}] ${result.ticker}… ${result.sector || "—"} / ${result.industry || "—"} (SIC ${result.sic || "—"})`
        );
      } else {
        console.log(`[${index}/${total}] ${result.ticker}… failed: ${result.error}`);
      }
    },
  });

  console.log(`\nDone: ${succeeded} succeeded, ${failed} failed.`);
  if (failed) {
    for (const row of results.filter((r) => !r.ok).slice(0, 25)) {
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
