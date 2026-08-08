import {
  edgarFilingBaseUrl,
  secFetchJson,
  secFetchText,
  secThrottle,
  type SecFetchOptions,
} from "../http.js";
import { withRetry, type RetryOptions } from "../retry.js";
import type { Sec13FFilingRef } from "./types.js";

export interface EdgarIndexItem {
  name: string;
  type?: string;
  size?: string;
  description?: string;
}

export interface EdgarFilingIndex {
  directory: {
    item: EdgarIndexItem | EdgarIndexItem[];
  };
}

function normalizeIndexItems(item: EdgarIndexItem | EdgarIndexItem[] | undefined): EdgarIndexItem[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export function edgarFilingIndexUrl(filing: Pick<Sec13FFilingRef, "filerCik" | "accessionNumber">): string {
  return `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/index.json`;
}

export function edgarDocumentUrl(
  filing: Pick<Sec13FFilingRef, "filerCik" | "accessionNumber">,
  documentName: string
): string {
  return `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/${documentName}`;
}

function isInfoTableCandidate(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.endsWith(".xml")) return false;
  if (n.includes("primary_doc")) return false;
  if (n.includes("index")) return false;
  return true;
}

async function looksLikeInformationTable(
  url: string,
  options: SecFetchOptions
): Promise<boolean> {
  const head = await secFetchText(url, options);
  const snippet = head.slice(0, 4000).toLowerCase();
  return snippet.includes("<informationtable") || snippet.includes(":informationtable");
}

/**
 * Resolve the information table XML filename for a 13F filing via `index.json`.
 */
export interface Find13FInfoTableDocumentOptions extends SecFetchOptions, RetryOptions {}

export async function find13FInfoTableDocument(
  filing: Sec13FFilingRef,
  options: Find13FInfoTableDocumentOptions = {}
): Promise<string> {
  const indexUrl = edgarFilingIndexUrl(filing);
  await secThrottle();
  const index = await withRetry(() => secFetchJson<EdgarFilingIndex>(indexUrl, options), options);
  const items = normalizeIndexItems(index.directory?.item);

  const preferred = items
    .map((i) => i.name)
    .filter((name) => isInfoTableCandidate(name))
    .sort((a, b) => {
      const score = (n: string) => {
        const l = n.toLowerCase();
        if (l.includes("infotable") || l.includes("informationtable")) return 0;
        if (/^\d+\.xml$/.test(l)) return 1;
        return 2;
      };
      return score(a) - score(b);
    });

  for (const name of preferred) {
    const url = edgarDocumentUrl(filing, name);
    await secThrottle();
    if (await looksLikeInformationTable(url, options)) return name;
  }

  throw new Error(
    `No 13F information table XML found in filing index for ${filing.accessionNumber}`
  );
}

/** @deprecated Import from `./downloadInfoTable.js` — download only, with retries. */
export { download13FInfoTableXml } from "./downloadInfoTable.js";
