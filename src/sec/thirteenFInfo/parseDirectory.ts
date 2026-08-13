import { parseFilingQuarter } from "./quarter.js";
import type { ThirteenFInfoManagerRaw } from "./types.js";
import { THIRTEEN_F_INFO_SOURCE } from "./types.js";

export const THIRTEEN_F_INFO_ORIGIN = "https://13f.info";
export const MANAGERS_DIRECTORY_URL = `${THIRTEEN_F_INFO_ORIGIN}/managers/`;

/** Letter directory paths: 0 (digits/symbols) then a–z. */
export const MANAGER_DIRECTORY_LETTERS: readonly string[] = [
  "0",
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
];

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(text: string): string {
  return String(text || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (full, name: string) => ENTITY_MAP[name] ?? full)
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
}

/**
 * Discover letter directory paths from the /managers/ index HTML.
 * Falls back to the known a–z / 0 set if the index markup changes.
 */
export function parseManagerDirectoryLetters(html: string): string[] {
  const found = new Set<string>();
  const re = /href="\/managers\/([0a-z])"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    found.add(m[1].toLowerCase());
  }
  if (found.size >= 20) {
    return MANAGER_DIRECTORY_LETTERS.filter((letter) => found.has(letter));
  }
  return [...MANAGER_DIRECTORY_LETTERS];
}

export function managerSourceUrl(slug: string): string {
  return `${THIRTEEN_F_INFO_ORIGIN}/manager/${slug}`;
}

export function directoryLetterUrl(letter: string): string {
  return `${THIRTEEN_F_INFO_ORIGIN}/managers/${letter.toLowerCase()}`;
}

/**
 * Parse one alphabetical managers directory page into raw manager rows.
 * Preserves exact displayed names; does not merge similar names.
 */
export function parseManagersDirectoryPage(
  html: string,
  { letter }: { letter: string }
): ThirteenFInfoManagerRaw[] {
  const rows: ThirteenFInfoManagerRaw[] = [];
  const rowRe =
    /<tr\b[^>]*>[\s\S]*?<a\s+href="\/manager\/([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<\/tr>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html)) !== null) {
    const rowHtml = match[0];
    const slug = decodeHtmlEntities(match[1]).trim();
    if (!slug) continue;

    const name = stripTags(match[2]);
    if (!name) continue;

    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    const locationRaw = cells.length >= 2 ? stripTags(cells[1]) : "";
    const location =
      locationRaw && !/^n\/?a$/i.test(locationRaw) && locationRaw !== "—"
        ? locationRaw
        : null;

    let quarterLabel: string | null = null;
    const filingLink = rowHtml.match(
      /href="\/13f\/[^"]*"[^>]*>\s*(Q[1-4]\s+\d{4})\s*</i
    );
    if (filingLink) {
      quarterLabel = filingLink[1].replace(/\s+/g, " ").trim();
    } else {
      const plain = rowHtml.match(/>\s*(Q[1-4]\s+\d{4})\s*</i);
      if (plain) quarterLabel = plain[1].replace(/\s+/g, " ").trim();
    }

    const parsedQuarter = parseFilingQuarter(quarterLabel);

    rows.push({
      id: slug,
      manager_name: name,
      location,
      latest_filing_quarter: parsedQuarter?.key ?? null,
      latest_filing_quarter_label: parsedQuarter?.label ?? quarterLabel,
      latest_filing_date: null,
      source_url: managerSourceUrl(slug),
      source: THIRTEEN_F_INFO_SOURCE,
      directory_letter: letter.toLowerCase(),
    });
  }

  return rows;
}

/**
 * Extract the most recent filing date from a manager detail page (Date Filed column).
 * Returns ISO date YYYY-MM-DD when present.
 */
export function parseLatestFilingDateFromManagerPage(html: string): string | null {
  const tbody = html.match(/Date Filed[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const block = tbody?.[1] ?? html;
  const firstRow = block.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  if (!firstRow) return null;
  const dates = [...firstRow[1].matchAll(/data-order="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
  // Typical row: period-end (data-order) then date-filed (data-order).
  if (dates.length >= 2) return dates[1];
  if (dates.length === 1) return dates[0];
  const visible = firstRow[1].match(/>(\d{1,2}\/\d{1,2}\/\d{4})</);
  if (visible) {
    const [mm, dd, yyyy] = visible[1].split("/").map((p) => Number(p));
    if (yyyy && mm && dd) {
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Exact dedupe by manager id (slug). First occurrence wins. */
export function dedupeManagersExact(
  rows: ThirteenFInfoManagerRaw[]
): { unique: ThirteenFInfoManagerRaw[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const unique: ThirteenFInfoManagerRaw[] = [];
  let duplicatesRemoved = 0;
  for (const row of rows) {
    const key = row.id;
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }
  return { unique, duplicatesRemoved };
}
