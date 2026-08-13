import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ThirteenFInfoHttpError, thirteenFInfoFetchText } from "./http.js";
import {
  MANAGERS_DIRECTORY_URL,
  MANAGER_DIRECTORY_LETTERS,
  dedupeManagersExact,
  directoryLetterUrl,
  parseLatestFilingDateFromManagerPage,
  parseManagerDirectoryLetters,
  parseManagersDirectoryPage,
} from "./parseDirectory.js";
import { isQuarterAtLeast, normalizeQuarterKey } from "./quarter.js";
import type {
  ThirteenFInfoManagerCandidate,
  ThirteenFInfoManagerRaw,
  ThirteenFInfoScrapeResult,
  ThirteenFInfoScrapeStats,
} from "./types.js";
import { THIRTEEN_F_INFO_SOURCE } from "./types.js";

export const DEFAULT_MINIMUM_QUARTER = "2026-Q1";

export interface ScrapeThirteenFInfoManagersOptions {
  /** Inclusive cutoff, e.g. "2026-Q1". */
  minimumQuarter?: string;
  /** Cache + output root. Default: data/13f-info */
  outDir?: string;
  /** Delay between HTTP requests (ms). */
  delayMs?: number;
  /** Re-fetch pages even when disk cache exists. */
  forceRefresh?: boolean;
  /** Limit to specific letters (e.g. ["a","b"]) for testing / resume slices. */
  letters?: string[];
  /** Skip letter pages already marked done in progress (resume). Default true. */
  resume?: boolean;
  /**
   * Fetch manager detail pages for included candidates to fill latest_filing_date.
   * Off by default — directory pages do not include filing dates.
   */
  enrichDates?: boolean;
  /** Cap how many included managers get date enrichment (0 = all). */
  enrichDatesLimit?: number;
  onProgress?: (message: string) => void;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function cachePagePath(cacheDir: string, letter: string): string {
  return join(cacheDir, "pages", `managers-${letter.toLowerCase()}.html`);
}

function managerCachePath(cacheDir: string, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return join(cacheDir, "managers", `${safe}.html`);
}

interface ProgressState {
  completedLetters: string[];
  updatedAt: string;
}

function loadProgress(path: string): ProgressState {
  if (!existsSync(path)) return { completedLetters: [], updatedAt: new Date().toISOString() };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ProgressState;
    return {
      completedLetters: Array.isArray(raw.completedLetters) ? raw.completedLetters : [],
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  } catch {
    return { completedLetters: [], updatedAt: new Date().toISOString() };
  }
}

function saveProgress(path: string, state: ProgressState): void {
  writeFileSync(
    path,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)
  );
}

function isRetryableThirteenFInfoError(err: unknown): boolean {
  if (err instanceof ThirteenFInfoHttpError) {
    return [429, 500, 502, 503, 504].includes(err.statusCode);
  }
  if (err instanceof TypeError) return true;
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND";
  }
  return false;
}

async function fetchTextCached(
  url: string,
  cachePath: string,
  {
    delayMs,
    forceRefresh,
    log,
  }: { delayMs: number; forceRefresh: boolean; log: (m: string) => void }
): Promise<string> {
  if (!forceRefresh && existsSync(cachePath)) {
    return readFileSync(cachePath, "utf8");
  }

  const maxAttempts = 4;
  let lastError: unknown;
  let wait = Math.max(delayMs, 500);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const html = await thirteenFInfoFetchText(url, { delayMs });
      ensureDir(join(cachePath, ".."));
      writeFileSync(cachePath, html, "utf8");
      return html;
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryableThirteenFInfoError(err)) break;
      log(`retry ${attempt} after ${wait}ms for ${url}`);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 8000);
    }
  }
  throw lastError;
}

function toCandidate(row: ThirteenFInfoManagerRaw): ThirteenFInfoManagerCandidate | null {
  if (!row.latest_filing_quarter) return null;
  return {
    id: row.id,
    manager_name: row.manager_name,
    location: row.location,
    latest_filing_quarter: row.latest_filing_quarter,
    latest_filing_date: row.latest_filing_date,
    source_url: row.source_url,
    source: THIRTEEN_F_INFO_SOURCE,
  };
}

function buildStats(
  allManagers: ThirteenFInfoManagerRaw[],
  candidates: ThirteenFInfoManagerCandidate[],
  duplicatesRemoved: number,
  minimumQuarter: string
): ThirteenFInfoScrapeStats {
  const withQuarter = allManagers.filter((m) => m.latest_filing_quarter).length;
  const missing = allManagers.length - withQuarter;
  const includedIds = new Set(candidates.map((c) => c.id));
  const excluded = allManagers.filter(
    (m) => m.latest_filing_quarter && !includedIds.has(m.id)
  ).length;
  return {
    totalManagersScraped: allManagers.length,
    totalWithDetectableQuarter: withQuarter,
    totalIncluded: candidates.length,
    totalExcluded: excluded,
    exactDuplicatesRemoved: duplicatesRemoved,
    missingFilingQuarter: missing,
    minimumQuarter,
  };
}

/**
 * Crawl the complete 13f.info managers directory and build a candidate universe
 * filtered to latest filing quarter >= minimumQuarter.
 *
 * Does not touch SEC EDGAR, CIK resolution, or portfolio/performance code.
 */
export async function scrapeThirteenFInfoManagers(
  options: ScrapeThirteenFInfoManagersOptions = {}
): Promise<ThirteenFInfoScrapeResult> {
  const minimumQuarter =
    normalizeQuarterKey(options.minimumQuarter || DEFAULT_MINIMUM_QUARTER) ||
    DEFAULT_MINIMUM_QUARTER;
  const outDir = options.outDir || join("data", "13f-info");
  const cacheDir = join(outDir, "cache");
  const delayMs = options.delayMs ?? 400;
  const forceRefresh = Boolean(options.forceRefresh);
  const resume = options.resume !== false;
  const enrichDates = Boolean(options.enrichDates);
  const enrichDatesLimit = Math.max(0, options.enrichDatesLimit ?? 0);
  const log = options.onProgress || ((m: string) => console.log(m));

  ensureDir(join(cacheDir, "pages"));
  ensureDir(join(cacheDir, "managers"));

  const progressPath = join(cacheDir, "progress.json");
  const progress = resume && !forceRefresh ? loadProgress(progressPath) : {
    completedLetters: [] as string[],
    updatedAt: new Date().toISOString(),
  };

  const indexCache = join(cacheDir, "pages", "managers-index.html");
  log(`Fetching managers index: ${MANAGERS_DIRECTORY_URL}`);
  const indexHtml = await fetchTextCached(MANAGERS_DIRECTORY_URL, indexCache, {
    delayMs,
    forceRefresh,
    log,
  });

  const discovered = parseManagerDirectoryLetters(indexHtml);
  const requested = (options.letters?.length
    ? options.letters.map((l) => l.toLowerCase())
    : discovered.length
      ? discovered
      : [...MANAGER_DIRECTORY_LETTERS]
  ).filter((l) => /^[0a-z]$/.test(l));

  const letters = [...new Set(requested)];
  log(`Directory letters to crawl: ${letters.join(", ")} (${letters.length})`);

  const collected: ThirteenFInfoManagerRaw[] = [];

  for (const letter of letters) {
    const pagePath = cachePagePath(cacheDir, letter);
    const url = directoryLetterUrl(letter);
    const cached = existsSync(pagePath);
    const useCache = cached && !forceRefresh;

    if (useCache) {
      log(`[${letter}] using cache ${pagePath}`);
    } else {
      log(`[${letter}] fetching ${url}`);
    }

    const html = await fetchTextCached(url, pagePath, {
      delayMs,
      forceRefresh,
      log,
    });

    const rows = parseManagersDirectoryPage(html, { letter });
    collected.push(...rows);
    log(`[${letter}] parsed ${rows.length} managers`);

    if (!progress.completedLetters.includes(letter)) {
      progress.completedLetters.push(letter);
      saveProgress(progressPath, progress);
    } else if (resume) {
      saveProgress(progressPath, progress);
    }
  }

  const { unique, duplicatesRemoved } = dedupeManagersExact(collected);
  log(
    `Deduped exact ids: ${collected.length} → ${unique.length} (removed ${duplicatesRemoved})`
  );

  let working = unique;

  const candidatesPreview = working.filter(
    (m) => m.latest_filing_quarter && isQuarterAtLeast(m.latest_filing_quarter, minimumQuarter)
  );

  if (enrichDates && candidatesPreview.length) {
    const toEnrich =
      enrichDatesLimit > 0 ? candidatesPreview.slice(0, enrichDatesLimit) : candidatesPreview;
    log(`Enriching latest_filing_date for ${toEnrich.length} included manager(s)…`);
    const byId = new Map(working.map((m) => [m.id, m]));
    for (let i = 0; i < toEnrich.length; i++) {
      const row = toEnrich[i];
      const cachePath = managerCachePath(cacheDir, row.id);
      try {
        const html = await fetchTextCached(row.source_url, cachePath, {
          delayMs,
          forceRefresh,
          log: () => {},
        });
        const date = parseLatestFilingDateFromManagerPage(html);
        const current = byId.get(row.id);
        if (current) current.latest_filing_date = date;
        if ((i + 1) % 25 === 0 || i + 1 === toEnrich.length) {
          log(`  dates ${i + 1}/${toEnrich.length}`);
        }
      } catch (err) {
        log(
          `  date enrich failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    working = [...byId.values()];
  }

  const candidates = working
    .filter(
      (m) => m.latest_filing_quarter && isQuarterAtLeast(m.latest_filing_quarter, minimumQuarter)
    )
    .map((m) => toCandidate(m)!)
    .sort((a, b) => {
      const q = b.latest_filing_quarter.localeCompare(a.latest_filing_quarter);
      if (q !== 0) return q;
      return a.manager_name.localeCompare(b.manager_name);
    });

  const stats = buildStats(working, candidates, duplicatesRemoved, minimumQuarter);

  return {
    scrapedAt: new Date().toISOString(),
    minimumQuarter,
    source: THIRTEEN_F_INFO_SOURCE,
    directoryUrl: MANAGERS_DIRECTORY_URL,
    stats,
    candidates,
    allManagers: working,
  };
}
