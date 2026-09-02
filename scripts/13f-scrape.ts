/**
 * 13F quarterly ingest job: 13f.info import loop + ownership cache + institutional warms.
 * Same orchestration pattern as job:daily-scrape (politicians/insiders).
 *
 * Usage:
 *   npm run job:13f-scrape
 *   npm run job:13f-scrape -- --dry-run
 *   npm run job:13f-scrape -- --quarter=2026-Q2 --filings=1 --batch-size=150
 *   npm run job:13f-scrape -- --skip-warm
 *
 * Schedule:
 *   Windows: scripts/cron/run-13f-scrape.ps1
 *   Linux:   scripts/cron/run-13f-scrape.sh
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
  if (!process.env.PG_STATEMENT_TIMEOUT_MS) {
    process.env.PG_STATEMENT_TIMEOUT_MS = "600000";
  }
  const dryRun = hasFlag("--dry-run");
  const skipWarm = hasFlag("--skip-warm");
  const quarter =
    argValue("--quarter") ||
    process.env.THIRTEEN_F_MINIMUM_QUARTER ||
    "2026-Q2";
  const filings = argValue("--filings") || "1";
  const batchSize = argValue("--batch-size") || process.env.THIRTEEN_F_BATCH_SIZE || "150";

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  console.log("13F scrape job");
  console.log(`  when: ${new Date().toISOString()}`);
  console.log(`  quarter: ${quarter}`);
  console.log(`  filings per manager: ${filings}`);
  console.log(`  batch size: ${batchSize}`);
  if (dryRun) console.log("  mode: dry-run (no commands executed)");

  const results: StepResult[] = [];
  const t0 = Date.now();

  const importArgs = [
    `--filings=${filings}`,
    `--minimum-quarter=${quarter}`,
    `--batch-size=${batchSize}`,
  ];

  results.push(
    dryRun
      ? skip("institutions:import-13f-info:loop", "dry-run")
      : runNpm("institutions:import-13f-info:loop", importArgs)
  );

  const importStep = results[results.length - 1];
  const importOk = importStep.ok && !importStep.skipped;

  if (!skipWarm && (dryRun || importOk)) {
    const warmSteps = [
      "ownership:build-cache",
      "signals:warm-conviction-score",
      "signals:warm-top-entries",
      "signals:warm-institutional-discovery",
      "stocks:warm-institutional-accumulation",
      "stocks:warm-ownership-changes",
      "institutions:warm-most-accumulated",
      "stocks:warm-most-accumulated",
      "institutions:warm-new-positions",
      "institutions:warm-completely-sold",
    ];
    for (const script of warmSteps) {
      results.push(dryRun ? skip(script, "dry-run") : runNpm(script));
    }
  } else if (skipWarm) {
    results.push(skip("warm-caches", "--skip-warm"));
  } else {
    results.push(skip("warm-caches", "import failed"));
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
