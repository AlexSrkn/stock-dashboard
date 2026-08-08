/**
 * Normalized 13F holding for app / API / storage layers.
 * `fundName` is the institutional filer (manager) name from the filing.
 */
export interface Holding {
  fundName: string;
  issuer: string;
  cusip: string;
  shares: number;
  /** Market value in thousands of USD (SEC 13F convention). */
  value: number;
  /** Filing date (YYYY-MM-DD). */
  filingDate: string;
  /** Calendar quarter derived from report period, e.g. `2026-Q1`. */
  quarter: string;
}

/** Normalized holding row prepared for database insertion (snake_case). */
export interface HoldingDbInsert {
  filer_cik: string;
  accession_number: string;
  fund_name: string;
  issuer: string;
  cusip: string;
  ticker: string | null;
  shares: number;
  /** SEC 13F value in thousands of USD. */
  value: number;
  value_usd_thousands: number;
  filing_date: string;
  quarter: string;
  put_call: string | null;
  shares_type: string | null;
  security_type: string;
  option_type: string | null;
  discretion: string | null;
  title_of_class: string;
  row_hash: string;
}

/** Reference to a 13F-HR / 13F-HR/A filing from EDGAR submissions. */
export interface Sec13FFilingRef {  filerCik: string;
  filerName: string | null;
  accessionNumber: string;
  formType: "13F-HR" | "13F-HR/A" | string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string | null;
}

/** Parsed row from a 13F information table XML (`infoTable`). */
export interface Sec13FInfoTableRow {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  figi: string | null;
  valueUsdThousands: number;
  sharesOrPrincipalAmount: number;
  sharesOrPrincipalType: string | null;
  investmentDiscretion: string | null;
  putCall: string | null;
  otherManager: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

/** Normalized holding ready for JSON export and DB mapping. */
export interface Sec13FHoldingNormalized extends Sec13FInfoTableRow {
  filerCik: string;
  filerName: string | null;
  accessionNumber: string;
  formType: string;
  filingDate: string;
  reportPeriod: string | null;
  infoTableDocument: string;
  /** SHA-256 hex for idempotent upserts */
  rowHash: string;
}

export interface Sec13FFilingMeta {
  filerCik: string;
  filerName: string | null;
  accessionNumber: string;
  formType: string;
  filingDate: string;
  reportPeriod: string | null;
  infoTableDocument: string;
  holdingsCount: number;
}

export interface Sec13FIngestResult {
  filing: Sec13FFilingMeta;
  holdings: Sec13FHoldingNormalized[];
  postgres: {
    filing: Sec13FFilingInsert;
    holdings: Sec13FHoldingInsert[];
  };
}

export interface Sec13FFilingInsert {
  filer_cik: string;
  filer_name: string | null;
  accession_number: string;
  form_type: string;
  filing_date: string;
  report_period: string | null;
  info_table_document: string;
  holdings_count: number;
}

export interface Sec13FHoldingInsert {
  filer_cik: string;
  accession_number: string;
  name_of_issuer: string;
  title_of_class: string;
  cusip: string;
  figi: string | null;
  value_usd_thousands: number;
  shares_or_principal_amount: number;
  shares_or_principal_type: string | null;
  investment_discretion: string | null;
  put_call: string | null;
  other_manager: string | null;
  voting_sole: number | null;
  voting_shared: number | null;
  voting_none: number | null;
  row_hash: string;
}

export interface Fetch13FFilingsOptions {
  /** Institutional manager / filer CIK (13F is filed by the manager, not the issuer). */
  filerCik: number | string;
  /** Max 13F filings to process (most recent first). Default 5. */
  limit?: number;
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
}
