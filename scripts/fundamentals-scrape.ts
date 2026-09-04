/**
 * SEC 10-K / 10-Q fundamentals ingest job (all `stocks` table tickers by default).
 * Same orchestration pattern as job:daily-scrape and job:13f-scrape.
 *
 * Note: `stocks:warm-fundamentals` is the SEC→Postgres ingest (name is historical).
 * After ingest, this job warms signal caches that read `sec_financial_period`.
 * Stocks hub rankings (revenue growth / FCF / margins) query the DB live — no cache warm.
 *
 * Usage:
 *   npm run job:fundamentals-scrape
 *   npm run job:fundamentals-scrape:dry
 *   npm run job:fundamentals-scrape -- --limit=50
 *   npm run job:fundamentals-scrape -- --sp500
 *   npm run job:fundamentals-scrape -- --ticker=AAPL,MSFT
 *   npm run job:fundamentals-scrape -- --force
 *   npm run job:fundamentals-scrape -- --force --skip-warm
 *
 * Schedule:
 *   Windows: scripts/cron/run-fundamentals-scrape.ps1
 *   Linux:   scripts/cron/run-fundamentals-scrape.sh
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOG_DIR = join(ROOT, "data", "logs");

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

type StepResult = { name: string; ok: boolean; skipped?: boolean; detail?: string; ms: number };

function runNpm(script: string, extraArgs: string[] = []): StepResult {
  const name = extraArgs.length ? `${script} ${extraArgs.join(" ")}` : script;
  const started = Date.now();
  console.log(`\n═══ ${name} ═══`);
  const isWin = process.platform === "win32";
  const result = spawnSync(
    isWin ? "npm.cmd" : "npm",
    ["run", script, ...(extraArgs.length ? ["--", ...extraArgs] : [])],
    {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
      shell: isWin,
    }
  );
  const ms = Date.now() - started;
  const ok = result.status === 0;
  if (!ok) {
    const detail =
      result.error?.message ||
      (result.status == null ? "spawn failed" : `exit ${result.status}`);
    console.error(`✖ Failed: ${name} (${detail})`);
    return { name, ok: false, ms, detail };
  }
  console.log(`✔ Done: ${name} (${(ms / 1000).toFixed(1)}s)`);
  return { name, ok: true, ms };
}

function skip(name: string, reason: string): StepResult {
  console.log(`\n—— skip ${name}: ${reason}`);
  return { name, ok: true, skipped: true, detail: reason, ms: 0 };
}

function passthroughArgs(): string[] {
  const skipFlags = new Set(["--dry-run", "--skip-warm", "--force"]);
  return process.argv.slice(2).filter((a) => !skipFlags.has(a) && !a.startsWith("--dry-run="));
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const skipWarm = hasFlag("--skip-warm");
  const extra = passthroughArgs();
  const skipExisting = !hasFlag("--force");
  const ingestArgs = [
    ...(skipExisting ? ["--skip-existing"] : []),
    ...extra,
  ];

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  console.log("Fundamentals scrape job (SEC 10-K / 10-Q)");
  console.log(`  when: ${new Date().toISOString()}`);
  console.log(`  universe: stocks table (default; use --sp500 for S&P 500 only)`);
  console.log(`  skip-existing: ${skipExisting}`);
  console.log(`  warm caches: ${skipWarm ? "no (--skip-warm)" : "yes"}`);
  if (dryRun) console.log("  mode: dry-run (no commands executed)");

  const results: StepResult[] = [];
  const t0 = Date.now();

  results.push(
    dryRun
      ? skip("stocks:warm-fundamentals", "dry-run")
      : runNpm("stocks:warm-fundamentals", ingestArgs)
  );

  const ingestStep = results[results.length - 1];
  const ingestOk = ingestStep.ok && !ingestStep.skipped;

  // Caches that read sec_financial_period. Hub rankings hit Postgres live.
  if (!skipWarm && (dryRun || ingestOk)) {
    const warmSteps = ["signals:warm-hidden-gems", "signals:warm-conflict-signals"];
    for (const script of warmSteps) {
      results.push(dryRun ? skip(script, "dry-run") : runNpm(script));
    }
  } else if (skipWarm) {
    results.push(skip("warm-caches", "--skip-warm"));
  } else {
    results.push(skip("warm-caches", "ingest failed"));
  }

  console.log("\n════════ summary ════════");
  console.log(`  elapsed: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
  for (const r of results) {
    const tag = r.skipped ? "skip" : r.ok ? "ok" : "FAIL";
    console.log(
      `  [${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}` +
        (r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : "")
    );
  }

  if (results.some((r) => !r.ok && !r.skipped)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
