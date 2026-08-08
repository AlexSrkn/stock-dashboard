import { createHash } from "node:crypto";
import {
  edgarFilingBaseUrl,
  secFetchJson,
  secFetchText,
  secThrottle,
  type SecFetchOptions,
} from "../http.js";
import { edgarDocumentUrl } from "../thirteenF/filingIndex.js";
import { withRetry } from "../retry.js";
import type { Form4FilingRef } from "./types.js";

interface EdgarIndexItem {
  name: string;
  type?: string;
}

interface EdgarFilingIndex {
  directory?: { item?: EdgarIndexItem | EdgarIndexItem[] };
}

function normalizeIndexItems(item: EdgarIndexItem | EdgarIndexItem[] | undefined): EdgarIndexItem[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function isForm4XmlCandidate(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.endsWith(".xml")) return false;
  if (n.includes("index")) return false;
  return true;
}

async function looksLikeOwnershipDocument(url: string, options: SecFetchOptions): Promise<boolean> {
  const head = await secFetchText(url, options);
  const snippet = head.slice(0, 8000).toLowerCase();
  return (
    snippet.includes("<ownershipdocument") ||
    snippet.includes(":ownershipdocument") ||
    snippet.includes("nonderivativetable") ||
    snippet.includes("derivativetable")
  );
}

export function edgarFilingIndexUrl(filing: Pick<Form4FilingRef, "filerCik" | "accessionNumber">): string {
  return `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/index.json`;
}

/**
 * Resolve the ownership document XML for a Form 4 filing.
 */
export async function findForm4OwnershipDocument(
  filing: Form4FilingRef,
  options: SecFetchOptions = {}
): Promise<string> {
  const primary = filing.primaryDocument?.trim();
  if (primary && primary.toLowerCase().endsWith(".xml")) {
    const url = edgarDocumentUrl(filing, primary);
    if (await looksLikeOwnershipDocument(url, options)) return primary;
  }

  const indexUrl = edgarFilingIndexUrl(filing);
  await secThrottle();
  const index = await withRetry(() => secFetchJson<EdgarFilingIndex>(indexUrl, options));
  const items = normalizeIndexItems(index.directory?.item);

  const candidates = items
    .map((i) => i.name)
    .filter((name) => isForm4XmlCandidate(name))
    .sort((a, b) => {
      const score = (n: string) => {
        const l = n.toLowerCase();
        if (l.includes("ownership") || l.includes("form4") || l.includes("doc4")) return 0;
        if (/^[^/]+\.xml$/.test(l)) return 1;
        return 2;
      };
      return score(a) - score(b);
    });

  for (const name of candidates) {
    const url = edgarDocumentUrl(filing, name);
    await secThrottle();
    if (await looksLikeOwnershipDocument(url, options)) return name;
  }

  if (candidates.length) return candidates[0];
  throw new Error(`No Form 4 ownership XML found for ${filing.accessionNumber}`);
}

export function form4RowHash(accessionNumber: string, rowKey: string): string {
  return createHash("sha256").update(`${accessionNumber}|${rowKey}`).digest("hex");
}
