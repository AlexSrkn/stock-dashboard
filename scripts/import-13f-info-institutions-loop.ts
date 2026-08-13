/**
 * Watchdog loop for the 13f.info institution import.
 * Runs fresh Node processes in batches so long-run native crashes don't lose progress.
 *
 * Usage:
 *   npm run institutions:import-13f-info:loop
 *   npm run institutions:import-13f-info:loop -- --batch-size=150
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROGRESS_PATH = join("data", "13f-info", "import-progress.json");

function readCompletedCount(): number {
  if (!existsSync(PROGRESS_PATH)) return 0;
  try {
    const raw = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as {
      completedCiks?: string[];
    };
    return Array.isArray(raw.completedCiks) ? raw.completedCiks.length : 0;
  } catch {
    return 0;
  }
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

function runBatch(batchSize: number, passthrough: string[]): Promise<number> {
  const args = [
    "scripts/import-13f-info-institutions.ts",
    "--minimum-quarter=2026-Q1",
    "--source=data/13f-info/managers-all.json",
    "--filings=8",
    "--delay-ms=250",
    "--skip-cache",
    `--batch-size=${batchSize}`,
    ...passthrough,
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
  let round = 0;
  let stagnant = 0;
  let lastCompleted = readCompletedCount();

  console.log(
    `Watchdog starting (batch-size=${batchSize}, completed=${lastCompleted}). Ctrl+C to stop.`
  );

  while (true) {
    round += 1;
    console.log(`\n======== Watchdog round ${round} · completed ${lastCompleted} ========`);
    const code = await runBatch(batchSize, passthrough);
    const completed = readCompletedCount();
    const gained = completed - lastCompleted;
    console.log(
      `Round ${round} finished (exit=${code}). Progress ${completed} (+${gained}).`
    );

    if (code === 0 && gained === 0) {
      console.log("Import complete (no remaining work).");
      break;
    }

    if (gained > 0) {
      stagnant = 0;
    } else {
      stagnant += 1;
    }

    // exit 2 = more work left (normal). Crash codes / 1 = retry a few times.
    if (stagnant >= 5) {
      console.error(
        `No progress for ${stagnant} rounds (completed=${completed}, last exit=${code}). Stopping.`
      );
      process.exitCode = 1;
      break;
    }

    lastCompleted = completed;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\nDone. Final completed=${readCompletedCount()}.`);
  console.log("Next: npm run ownership:build-cache");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
