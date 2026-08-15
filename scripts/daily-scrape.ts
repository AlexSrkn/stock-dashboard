/**
 * Overnight data job: Congress + Form 4 daily; 13F only inside filing windows; then warm Signals.
 *
 * Usage:
 *   npm run job:daily-scrape
 *   npm run job:daily-scrape -- --dry-run
 *   npm run job:daily-scrape -- --force-13f
 *   npm run job:daily-scrape -- --skip-13f --skip-warm
 *
 * Flags:
 *   --dry-run          Print plan only
 *   --force-13f        Run 13F even outside filing windows
 *   --skip-13f         Never run 13F
 *   --skip-politicians Skip House/Senate PTR
 *   --skip-insiders    Skip Form 4 ingest
 *   --skip-warm        Skip signal/cache warm
 *   --only-warm        Skip all scrapes; warm caches only
 *   --tz=America/New_York   Calendar TZ for filing-window check (default NY)
 *
 * Schedule (examples):
 *   Linux crontab (00:05 Europe/Amsterdam):
 *     5 0 * * * cd /path/to/stock-dashboard && /usr/bin/npm run job:daily-scrape >> data/logs/daily-scrape.log 2>&1
 *   Windows Task Scheduler: run scripts/cron/run-daily-scrape.ps1 at 00:05
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  calendarDateInTz,
  getActiveThirteenFFilingWindow,
} from "../src/jobs/thirteenFFilingWindows.js";

const ROOT = process.cwd();
const LOG_DIR = join(ROOT, "data", "logs");

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

type StepResult = { name: string; ok: boolean; skipped?: boolean; detail?: string; ms: number };

function runNpm(script: string, extraArgs: string[] = []): StepResult {
  const name = extraArgs.length ? `${script} ${extraArgs.join(" ")}` : script;
  const started = Date.now();
  console.log(`\n═══ ${name} ═══`);
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", script, ...(extraArgs.length ? ["--", ...extraArgs] : [])],
    {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
      shell: false,
    }
  );
  const ms = Date.now() - started;
  const ok = result.status === 0;
  if (!ok) {
    console.error(`✖ Failed: ${name} (exit ${result.status ?? "null"})`);
  } else {
    console.log(`✔ Done: ${name} (${(ms / 1000).toFixed(1)}s)`);
  }
  return { name, ok, ms, detail: ok ? undefined : `exit ${result.status}` };
}

function skip(name: string, reason: string): StepResult {
  console.log(`\n—— skip ${name}: ${reason}`);
  return { name, ok: true, skipped: true, detail: reason, ms: 0 };
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const onlyWarm = hasFlag("--only-warm");
  const skipPoliticians = onlyWarm || hasFlag("--skip-politicians");
  const skipInsiders = onlyWarm || hasFlag("--skip-insiders");
  const skipWarm = hasFlag("--skip-warm");
  const skip13f = hasFlag("--skip-13f");
  const force13f = hasFlag("--force-13f");
  const timeZone = argValue("--tz") || process.env.DAILY_SCRAPE_TZ || "America/New_York";

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const today = calendarDateInTz(new Date(), timeZone);
  const window = getActiveThirteenFFilingWindow(new Date(), timeZone);
  const run13f = !skip13f && !onlyWarm && (force13f || window != null);

  console.log("Daily scrape job");
  console.log(`  when: ${new Date().toISOString()}`);
  console.log(`  calendar (${timeZone}): ${today}`);
  console.log(
    `  13F window: ${window ? `${window.label} (${window.start} → ${window.end})` : "none — skip 13F"}`
  );
  if (force13f && !window) console.log("  13F: forced via --force-13f");
  if (dryRun) console.log("  mode: dry-run (no commands executed)");

  const results: StepResult[] = [];
  const t0 = Date.now();

  const plan: Array<() => StepResult> = [];

  if (!skipPoliticians) {
    plan.push(() =>
      dryRun
        ? skip("politicians:fetch-since-last", "dry-run")
        : runNpm("politicians:fetch-since-last", ["--skip-party"])
    );
  } else {
    plan.push(() => skip("politicians", "flag"));
  }

  if (!skipInsiders) {
    // Incremental Form 4 for tickers already in DB (fast enough for nightly).
    plan.push(() =>
      dryRun
        ? skip("db:ingest-all-insider-form4", "dry-run")
        : runNpm("db:ingest-all-insider-form4", ["--since-db", "--existing-only"])
    );
  } else {
    plan.push(() => skip("insiders", "flag"));
  }

  if (run13f) {
    // Last 2 filings/manager: picks up new 13F-HR in-window; duplicates are no-ops.
    plan.push(() =>
      dryRun
        ? skip("db:ingest-institutional-13f", "dry-run")
        : runNpm("db:ingest-institutional-13f", ["--filings", "2"])
    );
  } else {
    plan.push(() =>
      skip(
        "db:ingest-institutional-13f",
        skip13f ? "--skip-13f" : onlyWarm ? "--only-warm" : "outside filing window"
      )
    );
  }

  if (!skipWarm) {
    // Congress + insider dependent signals (always after daily scrapes).
    const alwaysWarm = [
      "insider-clusters:warm-cache",
      "insiders:warm-conviction-buys",
      "insiders:warm-repeat-buyers",
      "insiders:warm-sentiment",
      "insiders:warm-first-time-buyers",
      "insiders:warm-heavy-selling",
      "smart-money:warm-cache",
      "signals:warm-double-signal",
      "signals:warm-triple-signal",
      "signals:warm-conflict-signals",
      "signals:warm-hidden-gems",
      "signals:warm-conviction-score",
    ];

    // Institutional / ownership signals — refresh when 13F ran (or --only-warm).
    const institutionalWarm = [
      "signals:warm-top-entries",
      "signals:warm-institutional-discovery",
      "stocks:warm-institutional-accumulation",
      "stocks:warm-ownership-changes",
      "institutions:warm-most-accumulated",
      "stocks:warm-most-accumulated",
      "institutions:warm-new-positions",
      "institutions:warm-completely-sold",
    ];

    const warmList = [...alwaysWarm, ...(run13f || onlyWarm ? institutionalWarm : [])];

    for (const script of warmList) {
      plan.push(() => (dryRun ? skip(script, "dry-run") : runNpm(script)));
    }
  } else {
    plan.push(() => skip("warm-caches", "--skip-warm"));
  }

  for (const step of plan) {
    results.push(step());
  }

  const failed = results.filter((r) => !r.ok);
  const ran = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  console.log("\n════════ summary ════════");
  console.log(`  elapsed: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
  console.log(`  ran: ${ran.length}, skipped: ${skipped.length}, failed: ${failed.length}`);
  for (const r of results) {
    const tag = r.skipped ? "skip" : r.ok ? "ok" : "FAIL";
    console.log(
      `  [${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}${r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : ""}`
    );
  }

  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
