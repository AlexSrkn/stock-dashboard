import {
  edgarFilingBaseUrl,
  formatSecCik,
  resolveSecUserAgent,
  SecHttpError,
  type SecFetchOptions,
} from "../http.js";
import { downloadSecSubmissionsJson, secSubmissionsUrl } from "../submissions.js";
import { discover13FFilings } from "./discover.js";
import type { Sec13FFilingRef } from "./types.js";

export type Fetch13FErrorCode =
  | "INVALID_CIK"
  | "SUBMISSIONS_FETCH_FAILED"
  | "INVALID_SUBMISSIONS"
  | "NO_13F_FILING";

export class Fetch13FError extends Error {
  readonly code: Fetch13FErrorCode;
  readonly cik: string | null;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: Fetch13FErrorCode,
    options: { cik?: string | null; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "Fetch13FError";
    this.code = code;
    this.cik = options.cik ?? null;
    this.cause = options.cause;
  }
}

export interface Fetch13FOptions extends SecFetchOptions {
  /** Institutional filer CIK (13F-HR is filed by the manager). */
  cik: number | string;
}

/** Latest 13F-HR / 13F-HR/A filing metadata from EDGAR submissions. */
export interface Latest13FFilingMetadata extends Sec13FFilingRef {
  acceptanceDateTime: string | null;
  act: string | null;
  fileNumber: string | null;
  primaryDocDescription: string | null;
  submissionsUrl: string;
  edgarIndexUrl: string;
  edgarArchiveUrl: string;
}

export interface Fetch13FResult {
  cik: string;
  filerName: string | null;
  /** Most recent 13F filing in submissions.recent, or null if none. */
  latest: Latest13FFilingMetadata | null;
}

function validateCikInput(cik: number | string): string {
  const formatted = formatSecCik(cik);
  if (!formatted || formatted === "0000000000") {
    throw new Fetch13FError("Invalid CIK: provide a non-empty numeric CIK", "INVALID_CIK", {
      cik: String(cik),
    });
  }
  return formatted;
}

function enrichFilingMetadata(
  filing: Sec13FFilingRef,
  submissionsUrl: string,
  extra: {
    acceptanceDateTime: string | null;
    act: string | null;
    fileNumber: string | null;
    primaryDocDescription: string | null;
  }
): Latest13FFilingMetadata {
  return {
    ...filing,
    ...extra,
    submissionsUrl,
    edgarIndexUrl: `${edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber)}/index.json`,
    edgarArchiveUrl: edgarFilingBaseUrl(filing.filerCik, filing.accessionNumber),
  };
}

function metadataFromSubmissionsIndex(
  submissionsUrl: string,
  filing: Sec13FFilingRef,
  index: number,
  recent: {
    acceptanceDateTime?: string[];
    act?: string[];
    fileNumber?: string[];
    primaryDocDescription?: string[];
  }
): Latest13FFilingMetadata {
  return enrichFilingMetadata(filing, submissionsUrl, {
    acceptanceDateTime: recent.acceptanceDateTime?.[index] ?? null,
    act: recent.act?.[index] ?? null,
    fileNumber: recent.fileNumber?.[index] ?? null,
    primaryDocDescription: recent.primaryDocDescription?.[index] ?? null,
  });
}

function findRecentFilingIndex(accessionNumbers: string[], accessionNumber: string): number {
  return accessionNumbers.findIndex((a) => a === accessionNumber);
}

/**
 * Fetch SEC submissions for a CIK and return metadata for the latest 13F-HR / 13F-HR/A filing.
 *
 * Uses a descriptive `User-Agent` per SEC fair-access policy (`SEC_USER_AGENT` env or option).
 */
export async function fetchLatest13F(options: Fetch13FOptions): Promise<Fetch13FResult> {
  let cik: string;
  try {
    cik = validateCikInput(options.cik);
  } catch (err) {
    if (err instanceof Fetch13FError) throw err;
    throw new Fetch13FError("Invalid CIK", "INVALID_CIK", { cik: String(options.cik), cause: err });
  }

  const submissionsUrl = secSubmissionsUrl(cik);
  const fetchOpts: SecFetchOptions = {
    userAgent: resolveSecUserAgent(options.userAgent),
    fetch: options.fetch,
  };

  let submissions;
  try {
    submissions = await downloadSecSubmissionsJson({ cik, ...fetchOpts });
  } catch (err) {
    if (err instanceof SecHttpError) {
      throw new Fetch13FError(
        `Failed to fetch SEC submissions: ${err.message}`,
        "SUBMISSIONS_FETCH_FAILED",
        { cik, cause: err }
      );
    }
    throw new Fetch13FError(
      `Failed to fetch SEC submissions: ${err instanceof Error ? err.message : String(err)}`,
      "SUBMISSIONS_FETCH_FAILED",
      { cik, cause: err }
    );
  }

  if (!submissions?.filings?.recent?.form?.length) {
    throw new Fetch13FError(
      "SEC submissions JSON is missing filings.recent",
      "INVALID_SUBMISSIONS",
      { cik }
    );
  }

  const discovered = discover13FFilings(submissions, 1);
  if (!discovered.length) {
    return {
      cik,
      filerName: submissions.name ?? null,
      latest: null,
    };
  }

  const latestRef = discovered[0];
  const recent = submissions.filings.recent;
  const idx = findRecentFilingIndex(recent.accessionNumber ?? [], latestRef.accessionNumber);

  const latest =
    idx >= 0
      ? metadataFromSubmissionsIndex(submissionsUrl, latestRef, idx, recent)
      : enrichFilingMetadata(latestRef, submissionsUrl, {
          acceptanceDateTime: null,
          act: null,
          fileNumber: null,
          primaryDocDescription: null,
        });

  return {
    cik,
    filerName: submissions.name ?? null,
    latest,
  };
}

/**
 * Like {@link fetchLatest13F} but throws if no 13F filing exists in recent submissions.
 */
export async function fetchLatest13FOrThrow(
  options: Fetch13FOptions
): Promise<Fetch13FResult & { latest: Latest13FFilingMetadata }> {
  const result = await fetchLatest13F(options);
  if (!result.latest) {
    throw new Fetch13FError(
      `No 13F-HR or 13F-HR/A filing found in recent submissions for CIK ${result.cik}`,
      "NO_13F_FILING",
      { cik: result.cik }
    );
  }
  return result as Fetch13FResult & { latest: Latest13FFilingMetadata };
}

/** Throws when no 13F exists (alias for {@link fetchLatest13FOrThrow}). */
export const fetch13FOrThrow = fetchLatest13FOrThrow;

/** Recent 13F-HR / 13F-HR/A filings for a filer, newest filing date first. */
export async function fetchRecent13FFilings(
  options: Fetch13FOptions & { limit?: number }
): Promise<{ cik: string; filerName: string | null; filings: Latest13FFilingMetadata[] }> {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 40));
  let cik: string;
  try {
    cik = validateCikInput(options.cik);
  } catch (err) {
    if (err instanceof Fetch13FError) throw err;
    throw new Fetch13FError("Invalid CIK", "INVALID_CIK", { cik: String(options.cik), cause: err });
  }

  const submissionsUrl = secSubmissionsUrl(cik);
  const fetchOpts: SecFetchOptions = {
    userAgent: resolveSecUserAgent(options.userAgent),
    fetch: options.fetch,
  };

  let submissions;
  try {
    submissions = await downloadSecSubmissionsJson({ cik, ...fetchOpts });
  } catch (err) {
    if (err instanceof SecHttpError) {
      throw new Fetch13FError(
        `Failed to fetch SEC submissions: ${err.message}`,
        "SUBMISSIONS_FETCH_FAILED",
        { cik, cause: err }
      );
    }
    throw new Fetch13FError(
      `Failed to fetch SEC submissions: ${err instanceof Error ? err.message : String(err)}`,
      "SUBMISSIONS_FETCH_FAILED",
      { cik, cause: err }
    );
  }

  if (!submissions?.filings?.recent?.form?.length) {
    throw new Fetch13FError(
      "SEC submissions JSON is missing filings.recent",
      "INVALID_SUBMISSIONS",
      { cik }
    );
  }

  const discovered = discover13FFilings(submissions, limit);
  const recent = submissions.filings.recent;
  const filings: Latest13FFilingMetadata[] = discovered.map((ref) => {
    const idx = findRecentFilingIndex(recent.accessionNumber ?? [], ref.accessionNumber);
    if (idx >= 0) {
      return metadataFromSubmissionsIndex(submissionsUrl, ref, idx, recent);
    }
    return enrichFilingMetadata(ref, submissionsUrl, {
      acceptanceDateTime: null,
      act: null,
      fileNumber: null,
      primaryDocDescription: null,
    });
  });

  return {
    cik,
    filerName: submissions.name ?? null,
    filings,
  };
}

/** Primary entry point (alias for {@link fetchLatest13F}). */
export const fetch13F = fetchLatest13F;
