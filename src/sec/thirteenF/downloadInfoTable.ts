import { secFetchText, secThrottle, type SecFetchOptions } from "../http.js";
import { withRetry, type RetryOptions } from "../retry.js";
import { fetch13FOrThrow, type Latest13FFilingMetadata } from "./fetch13F.js";
import {
  edgarDocumentUrl,
  find13FInfoTableDocument,
} from "./filingIndex.js";
import type { Sec13FFilingRef } from "./types.js";

export type Download13FInfoTableErrorCode =
  | "INFO_TABLE_NOT_FOUND"
  | "INFO_TABLE_DOWNLOAD_FAILED"
  | "INFO_TABLE_EMPTY"
  | "INVALID_XML";

export class Download13FInfoTableError extends Error {
  readonly code: Download13FInfoTableErrorCode;
  readonly url: string | null;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: Download13FInfoTableErrorCode,
    options: { url?: string | null; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "Download13FInfoTableError";
    this.code = code;
    this.url = options.url ?? null;
    this.cause = options.cause;
  }
}

export interface Download13FInfoTableRetryOptions extends RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
}

export interface Download13FInfoTableOptions extends SecFetchOptions, Download13FInfoTableRetryOptions {}

/** Raw XML download result (no parsing). */
export interface Download13FInfoTableResult {
  xml: string;
  documentName: string;
  url: string;
}

export interface DownloadLatest13FInfoTableOptions extends Download13FInfoTableOptions {
  cik: number | string;
}

export interface DownloadLatest13FInfoTableResult extends Download13FInfoTableResult {
  filing: Latest13FFilingMetadata;
}

function assertInformationTableXml(xml: string, url: string): void {
  const trimmed = xml.trim();
  if (!trimmed) {
    throw new Download13FInfoTableError("Downloaded 13F information table XML is empty", "INFO_TABLE_EMPTY", {
      url,
    });
  }
  const lower = trimmed.slice(0, 8000).toLowerCase();
  if (!lower.includes("<informationtable") && !lower.includes(":informationtable")) {
    throw new Download13FInfoTableError(
      "Downloaded file does not appear to be a 13F information table",
      "INVALID_XML",
      { url }
    );
  }
}

async function fetchXmlWithRetry(url: string, options: Download13FInfoTableOptions): Promise<string> {
  const { maxAttempts, delayMs, backoffFactor, maxDelayMs, onRetry, ...secOpts } = options;
  return withRetry(() => secFetchText(url, secOpts), {
    maxAttempts,
    delayMs,
    backoffFactor,
    maxDelayMs,
    onRetry,
  });
}

/**
 * Download the 13F information table XML for a known filing (raw string, no parsing).
 */
export async function download13FInfoTableXml(
  filing: Sec13FFilingRef,
  options: Download13FInfoTableOptions = {}
): Promise<Download13FInfoTableResult> {
  let documentName: string;
  try {
    documentName = await withRetry(() => find13FInfoTableDocument(filing, options), {
      maxAttempts: options.maxAttempts,
      delayMs: options.delayMs,
      backoffFactor: options.backoffFactor,
      maxDelayMs: options.maxDelayMs,
      onRetry: options.onRetry,
    });
  } catch (err) {
    throw new Download13FInfoTableError(
      `Could not locate 13F information table document: ${err instanceof Error ? err.message : String(err)}`,
      "INFO_TABLE_NOT_FOUND",
      { cause: err }
    );
  }

  const url = edgarDocumentUrl(filing, documentName);
  await secThrottle();

  let xml: string;
  try {
    xml = await fetchXmlWithRetry(url, options);
  } catch (err) {
    throw new Download13FInfoTableError(
      `Failed to download 13F information table XML: ${err instanceof Error ? err.message : String(err)}`,
      "INFO_TABLE_DOWNLOAD_FAILED",
      { url, cause: err }
    );
  }

  assertInformationTableXml(xml, url);
  return { xml, documentName, url };
}

/**
 * Resolve the latest 13F filing for a CIK, then download its information table XML.
 */
export async function downloadLatest13FInfoTableXml(
  options: DownloadLatest13FInfoTableOptions
): Promise<DownloadLatest13FInfoTableResult> {
  const { cik, ...downloadOpts } = options;
  const { latest } = await fetch13FOrThrow({ cik, ...downloadOpts });

  const downloaded = await download13FInfoTableXml(latest, downloadOpts);
  return { ...downloaded, filing: latest };
}
