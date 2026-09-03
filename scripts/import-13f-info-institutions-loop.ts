/**
 * Watchdog loop for the 13f.info institution import.
 * Runs fresh Node processes in batches so long-run native crashes don't lose progress.
 *
 * Each job session tries every pending filer once (attemptedCiks), then exits 0
 * so cache/signal warms run even when many filers are still waiting on SEC Q2.
 *
 * Usage:
 *   npm run institutions:import-13f-info:loop
 *   npm run institutions:import-13f-info:loop -- --batch-size=150
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROGRESS_PATH = join("data", "13f-info", "import-progress.json");

function readProgressFile(): {
  quarters: Record<string, { completedCiks?: string[]; attemptedCiks?: string[] }>;
} {
  if (!existsSync(PROGRESS_PATH)) return { quarters: {} };
  try {
    const raw = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as {
      quarters?: Record<string, { completedCiks?: string[]; attemptedCiks?: string[] }>;
      minimumQuarter?: string;
      completedCiks?: string[];
    };
    if (raw.quarters) return { quarters: raw.quarters };
    if (raw.minimumQuarter) {
      return {
        quarters: {
          [raw.minimumQuarter]: { completedCiks: raw.completedCiks ?? [], attemptedCiks: [] },
        },
      };
    }
  } catch {
    /* ignore */
  }
  return { quarters: {} };
}

function readCompletedCount(minimumQuarter: string): number {
  const bucket = readProgressFile().quarters[minimumQuarter];
  return Array.isArray(bucket?.completedCiks) ? bucket.completedCiks.length : 0;
}

/** Cleared once per job session so each night tries every pending filer once. */
function clearAttemptedForQuarter(minimumQuarter: string): void {
  const file = JSON.parse(
    existsSync(PROGRESS_PATH) ? readFileSync(PROGRESS_PATH, "utf8") : "{}"
  ) as {
    quarters?: Record<
      string,
      { completedCiks?: string[]; attemptedCiks?: string[]; failed?: unknown[]; updatedAt?: string }
    >;
  };
  if (!file.quarters) file.quarters = {};
  if (!file.quarters[minimumQuarter]) {
    file.quarters[minimumQuarter] = { completedCiks: [], attemptedCiks: [], failed: [] };
  }
  file.quarters[minimumQuarter].attemptedCiks = [];
  file.quarters[minimumQuarter].updatedAt = new Date().toISOString();
  mkdirSync(join(PROGRESS_PATH, ".."), { recursive: true });
  writeFileSync(PROGRESS_PATH, JSON.stringify(file, null, 2));
}

function parseArgs(argv: string[]) {
  let batchSize = 150;
  const passthrough: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--batch-size=")) {
      batchSize = Math.max(25, Number(a.slice("--batch-size=".length)) || 150);
    } else if (a === "--batch-size" && argv[i + 1]) {
      batchSize = Math.max(25, Number(argv[++i]) || 150);
    } else {
      passthrough.push(a);
    }
  }
  return { batchSize, passthrough };
}

function resolveMinimumQuarter(passthrough: string[]): string {
  const fromArgs = passthrough.find((a) => a.startsWith("--minimum-quarter="));
  if (fromArgs) return fromArgs.slice("--minimum-quarter=".length);
  const idx = passthrough.indexOf("--minimum-quarter");
  if (idx >= 0 && passthrough[idx + 1]) return passthrough[idx + 1];
  return process.env.THIRTEEN_F_MINIMUM_QUARTER || "2026-Q2";
}

function runBatch(batchSize: number, passthrough: string[]): Promise<number> {
  const has = (flag: string) => passthrough.some((a) => a === flag || a.startsWith(`${flag}=`));
  const args = [
    "scripts/import-13f-info-institutions.ts",
    ...passthrough,
    ...(has("--minimum-quarter") ? [] : ["--minimum-quarter=2026-Q2"]),
    ...(has("--filings") ? [] : ["--filings=1"]),
    "--source=data/13f-info/managers-all.json",
    // VPS/datacenter IPs get SEC 503s more often than home — default slower than local.
    "--delay-ms=700",
    "--skip-cache",
    `--batch-size=${batchSize}`,
  ];
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", ...args], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        console.error(`Batch killed by signal ${signal}`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const { batchSize, passthrough } = parseArgs(process.argv.slice(2));
  const minimumQuarter = resolveMinimumQuarter(passthrough);
  let round = 0;
  const completedAtStart = readCompletedCount(minimumQuarter);

  clearAttemptedForQuarter(minimumQuarter);
  console.log(
    `Watchdog starting (quarter=${minimumQuarter}, batch-size=${batchSize}, completed=${completedAtStart}). Ctrl+C to stop.`
  );
  console.log("Each session tries every pending filer once, then exits for cache/signal warms.");

  while (true) {
    round += 1;
    const completedBefore = readCompletedCount(minimumQuarter);
    console.log(`\n======== Watchdog round ${round} · completed ${completedBefore} ========`);
    const code = await runBatch(batchSize, passthrough);
    const completedAfter = readCompletedCount(minimumQuarter);
    console.log(
      `Round ${round} finished (exit=${code}). Completed ${completedAfter} (+${completedAfter - completedBefore}).`
    );

    if (code === 2) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (code === 0) {
      console.log("Nightly pass complete (all pending filers attempted this session).");
      break;
    }

    console.error(`Batch failed (exit=${code}). Retrying once…`);
    await new Promise((r) => setTimeout(r, 5000));
    const retry = await runBatch(batchSize, passthrough);
    console.log(`Retry finished (exit=${retry}).`);
    if (retry === 2) continue;
    if (retry === 0) {
      console.log("Nightly pass complete after retry.");
      break;
    }
    console.error("Import loop stopping after repeated batch failure.");
    process.exitCode = 1;
    break;
  }

  const completedFinal = readCompletedCount(minimumQuarter);
  console.log(
    `\nDone. ${completedFinal} filers with ${minimumQuarter} (+${completedFinal - completedAtStart} this session).`
  );
  console.log("Proceeding to ownership cache + signal warms (via job:13f-scrape).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
