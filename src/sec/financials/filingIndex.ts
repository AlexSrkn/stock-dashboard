import {
  edgarFilingBaseUrl,
  secFetchJson,
  secFetchText,
  secThrottle,
  type SecFetchOptions,
} from "../http.js";
import type { EdgarFilingIndex, EdgarIndexItem } from "../thirteenF/filingIndex.js";

export type { EdgarFilingIndex, EdgarIndexItem };

export interface EdgarFilingRef {
  filerCik: number | string;
  accessionNumber: string;
}

export function edgarFilingIndexUrl(filing: EdgarFilingRef): string {
  return `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/index.json`;
}

export function edgarDocumentUrl(filing: EdgarFilingRef, documentName: string): string {
  return `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/${documentName}`;
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
  return secFetchJson<EdgarFilingIndex>(edgarFilingIndexUrl(filing), options);
}

export async function fetchEdgarDocument(
  filing: EdgarFilingRef,
  documentName: string,
  options: SecFetchOptions = {}
): Promise<string> {
  await secThrottle();
  return secFetchText(edgarDocumentUrl(filing, documentName), options);
}
