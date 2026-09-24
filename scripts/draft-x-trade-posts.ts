import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { getRecentInsiderTransactions } from "../src/insider/insiderAnalytics.js";
import {
  collectTradeDrafts,
  draftsToMarkdown,
  type XTradeDraft,
} from "../src/x/draftTradePosts.js";

loadEnvFile();

const OUT_DIR = join("data", "x-drafts");

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : null;
}

function parseSource(raw: string | null): "all" | "politicians" | "insiders" {
  if (raw === "politicians" || raw === "insiders" || raw === "all") return raw;
  return "all";
}

function todayStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function loadSeenIds(dir: string): Set<string> {
  const seen = new Set<string>();
  if (!existsSync(dir)) return seen;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(dir, name), "utf8");
      const parsed = JSON.parse(raw) as { drafts?: Array<{ id?: string }> };
      for (const d of parsed.drafts || []) {
        if (d.id) seen.add(d.id);
      }
    } catch {
      // ignore corrupt prior files
    }
  }
  return seen;
}

async function main() {
  const limit = Number(argValue("--limit") ?? "10") || 10;
  const source = parseSource(argValue("--source"));
  const dryRun = process.argv.includes("--dry-run");
  const maxAgeRaw = argValue("--max-age-days");
  const maxPoliticianTradeAgeDays =
    maxAgeRaw == null || maxAgeRaw === ""
      ? undefined
      : Math.max(0, Number(maxAgeRaw) || 0);
  const baseUrl =
    argValue("--base-url") ||
    process.env.AUTH_PUBLIC_ORIGIN?.trim() ||
    "https://investatlant.com";

  mkdirSync(OUT_DIR, { recursive: true });
  const seen = loadSeenIds(OUT_DIR);

  let insiderRows = undefined as Awaited<
    ReturnType<typeof getRecentInsiderTransactions>
  >["transactions"] | undefined;
  const warnings: string[] = [];

  if (source === "all" || source === "insiders") {
    try {
      const payload = await getRecentInsiderTransactions({
        limit: 500,
        signal: "all",
        codes: ["P", "S"],
      });
      insiderRows = payload.transactions;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Insiders skipped: ${message}`);
      if (source === "insiders") {
        console.error(warnings.join("\n"));
        process.exitCode = 1;
        return;
      }
    }
  }

  const { drafts, warnings: collectWarnings } = collectTradeDrafts({
    baseUrl,
    limit,
    source,
    insiderRows,
    seenIds: seen,
    maxPoliticianTradeAgeDays,
  });
  warnings.push(...collectWarnings);

  const generatedAt = new Date().toISOString();
  const stamp = todayStamp();
  const payload = {
    generatedAt,
    baseUrl,
    source,
    limit,
    count: drafts.length,
    warnings,
    drafts,
  };

  for (const w of warnings) console.warn(`⚠ ${w}`);

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log("\n--- markdown ---\n");
    console.log(draftsToMarkdown(drafts, generatedAt));
    return;
  }

  const jsonPath = join(OUT_DIR, `${stamp}.json`);
  const mdPath = join(OUT_DIR, `${stamp}.md`);

  // If today's file already exists, merge new drafts (still deduped via seen)
  let merged: XTradeDraft[] = drafts;
  if (existsSync(jsonPath)) {
    try {
      const prior = JSON.parse(readFileSync(jsonPath, "utf8")) as { drafts?: XTradeDraft[] };
      const byId = new Map<string, XTradeDraft>();
      for (const d of prior.drafts || []) byId.set(d.id, d);
      for (const d of drafts) byId.set(d.id, d);
      merged = [...byId.values()];
    } catch {
      merged = drafts;
    }
  }

  const outPayload = { ...payload, count: merged.length, drafts: merged };
  writeFileSync(jsonPath, `${JSON.stringify(outPayload, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, draftsToMarkdown(merged, generatedAt), "utf8");

  console.log(`Wrote ${merged.length} draft(s)`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  if (drafts.length) {
    console.log("\nLatest batch preview:");
    for (const [i, d] of drafts.slice(0, 5).entries()) {
      console.log(`\n[${i + 1}] ${d.charCount} chars\n${d.text}`);
    }
  } else {
    console.log("No new drafts (nothing matched filters, or all already seen).");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      // pool may never have opened
    }
  });
