/**
 * Precompute Insider Sentiment rankings from Form 4 open-market P/S.
 * Usage: npm run insiders:warm-sentiment
 */
import { computeInsiderSentiment } from "../src/insider/sentiment/compute.js";
import { saveInsiderSentimentToDisk } from "../src/insider/sentiment/cache.js";
import { getPool } from "../src/db/pool.js";

async function main() {
  const pool = getPool();
  try {
    console.log("Computing insider sentiment…");
    const payload = await computeInsiderSentiment(pool);
    if (!payload.rows.length) {
      console.warn("No open-market Form 4 P/S activity found.");
      return;
    }
    saveInsiderSentimentToDisk(payload);
    const bull = payload.rows.filter((r) => r.sentimentScore >= 40).length;
    const bear = payload.rows.filter((r) => r.sentimentScore <= -40).length;
    console.log(
      `Insider sentiment cache saved: ${payload.rows.length} tickers, ${bull} bullish, ${bear} bearish → data/cache/insider-sentiment.json`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
