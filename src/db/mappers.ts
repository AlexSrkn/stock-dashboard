import type { Latest13FFilingMetadata } from "../sec/thirteenF/fetch13F.js";
import { toQuarter } from "../sec/thirteenF/normalizeHoldings.js";
import type { HoldingDbInsert } from "../sec/thirteenF/types.js";
import type { FilingDbInsert } from "./types.js";

/** Map SEC filing metadata + DB holdings into ingest payload (no network). */
export function toIngestPayload(
  filing: Latest13FFilingMetadata & { infoTableDocument: string; holdingsCount: number },
  holdings: HoldingDbInsert[]
): { filing: FilingDbInsert; holdings: HoldingDbInsert[] } {
  return {
    filing: {
      filer_cik: filing.filerCik,
      accession_number: filing.accessionNumber,
      fund_name: filing.filerName ?? "Unknown fund",
      form_type: filing.formType,
      filing_date: filing.filingDate,
      report_period: filing.reportDate,
      quarter:
        holdings[0]?.quarter ?? toQuarter(filing.reportDate ?? filing.filingDate),
      info_table_document: filing.infoTableDocument,
      holdings_count: filing.holdingsCount,
      total_value: holdings.reduce((sum, h) => sum + Number(h.value ?? 0), 0),
    },
    holdings,
  };
}
