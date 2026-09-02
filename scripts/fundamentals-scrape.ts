/**
 * SEC 10-K / 10-Q fundamentals ingest job (all `stocks` table tickers by default).
 * Same orchestration pattern as job:daily-scrape and job:13f-scrape.
 *
 * Usage:
 *   npm run job:fundamentals-scrape
 *   npm run job:fundamentals-scrape:dry
 *   npm run job:fundamentals-scrape -- --limit=50
 *   npm run job:fundamentals-scrape -- --sp500
 *   npm run job:fundamentals-scrape -- --ticker=AAPL,MSFT
 *   npm run job:fundamentals-scrape -- --force
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

function passthroughArgs(): string[] {
  const skip = new Set(["--dry-run"]);
  return process.argv.slice(2).filter((a) => !skip.has(a) && !a.startsWith("--dry-run="));
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

async function main() {
  const dryRun = hasFlag("--dry-run");
  const extra = passthroughArgs();
  const skipExisting = !hasFlag("--force");
  const ingestArgs = [
    ...(skipExisting ? ["--skip-existing"] : []),
    ...extra.filter((a) => a !== "--force"),
  ];

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  console.log("Fundamentals scrape job (SEC 10-K / 10-Q)");
  console.log(`  when: ${new Date().toISOString()}`);
  console.log(`  universe: stocks table (default; use --sp500 for S&P 500 only)`);
  console.log(`  skip-existing: ${skipExisting}`);
  if (dryRun) console.log("  mode: dry-run (no commands executed)");

  const t0 = Date.now();
  const result = dryRun
    ? skip("stocks:warm-fundamentals", "dry-run")
    : runNpm("stocks:warm-fundamentals", ingestArgs);

  console.log("\n════════ summary ════════");
  console.log(`  elapsed: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
  const tag = result.skipped ? "skip" : result.ok ? "ok" : "FAIL";
  console.log(
    `  [${tag}] stocks:warm-fundamentals${result.detail ? ` — ${result.detail}` : ""}` +
      (result.ms ? ` (${(result.ms / 1000).toFixed(1)}s)` : "")
  );

  if (!result.ok && !result.skipped) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
