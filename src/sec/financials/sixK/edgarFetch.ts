import {
  edgarFilingBaseUrl,
  secFetchJson,
  secFetchText,
  secThrottle,
  type SecFetchOptions,
} from "../../http.js";
import type { EdgarFilingIndex, EdgarIndexItem } from "../../thirteenF/filingIndex.js";

export type { EdgarFilingIndex, EdgarIndexItem };

export interface EdgarFilingRef {
  filerCik: number | string;
  accessionNumber: string;
}

export function normalizeIndexItems(
  item: EdgarIndexItem | EdgarIndexItem[] | undefined
): EdgarIndexItem[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export async function fetchEdgarFilingIndex(
  filing: EdgarFilingRef,
  options: SecFetchOptions = {}
): Promise<EdgarFilingIndex> {
  await secThrottle();
  return secFetchJson<EdgarFilingIndex>(
    `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/index.json`,
    options
  );
}

export async function fetchEdgarDocument(
  filing: EdgarFilingRef,
  documentName: string,
  options: SecFetchOptions = {}
): Promise<string> {
  await secThrottle();
  return secFetchText(
    `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/${documentName}`,
    options
  );
}
