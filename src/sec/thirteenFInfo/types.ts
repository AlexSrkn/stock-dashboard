/** Candidate institution/manager harvested from 13f.info (not a verified EDGAR entity). */

export const THIRTEEN_F_INFO_SOURCE = "13f.info" as const;

export type ThirteenFInfoSource = typeof THIRTEEN_F_INFO_SOURCE;

/** Canonical quarter key, e.g. "2026-Q1". */
export type FilingQuarterKey = string;

export interface ThirteenFInfoManagerRaw {
  /** Stable slug from 13f.info, e.g. "0001540358-a16z-capital-management-l-l-c". */
  id: string;
  manager_name: string;
  location: string | null;
  latest_filing_quarter: FilingQuarterKey | null;
  /** Display text from the directory, e.g. "Q1 2026". */
  latest_filing_quarter_label: string | null;
  latest_filing_date: string | null;
  source_url: string;
  source: ThirteenFInfoSource;
  /** Letter directory page this row was parsed from (e.g. "a"). */
  directory_letter: string;
}

export interface ThirteenFInfoManagerCandidate {
  id: string;
  manager_name: string;
  location: string | null;
  latest_filing_quarter: FilingQuarterKey;
  latest_filing_date: string | null;
  source_url: string;
  source: ThirteenFInfoSource;
}

export interface ThirteenFInfoScrapeStats {
  totalManagersScraped: number;
  totalWithDetectableQuarter: number;
  totalIncluded: number;
  totalExcluded: number;
  exactDuplicatesRemoved: number;
  missingFilingQuarter: number;
  minimumQuarter: FilingQuarterKey;
}

export interface ThirteenFInfoScrapeResult {
  scrapedAt: string;
  minimumQuarter: FilingQuarterKey;
  source: ThirteenFInfoSource;
  directoryUrl: string;
  stats: ThirteenFInfoScrapeStats;
  candidates: ThirteenFInfoManagerCandidate[];
  /** All unique managers after exact dedupe (included + excluded + missing quarter). */
  allManagers: ThirteenFInfoManagerRaw[];
}
