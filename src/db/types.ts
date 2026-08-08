import type { HoldingDbInsert } from "../sec/thirteenF/types.js";

/** Filing row for `sec_filing` (deduped by `accession_number`). */
export interface FilingDbInsert {
  filer_cik: string;
  accession_number: string;
  fund_name: string;
  form_type: string;
  filing_date: string;
  report_period: string | null;
  quarter: string;
  info_table_document: string | null;
  holdings_count: number;
  total_value: number;
}

export interface IngestFilingPayload {
  filing: FilingDbInsert;
  holdings: HoldingDbInsert[];
}

export interface InsertFilingWithHoldingsResult {
  filingId: number;
  accessionNumber: string;
  /** True when this accession was already ingested (holdings not inserted again). */
  duplicateFiling: boolean;
  holdingsInserted: number;
  holdingsSkipped: number;
}

export type { HoldingDbInsert };
