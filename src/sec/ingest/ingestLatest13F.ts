import { toIngestPayload } from "../../db/mappers.js";
import type { InsertFilingWithHoldingsResult } from "../../db/types.js";
import { createHoldingsInsertService } from "../../db/index.js";
import type { Latest13FFilingMetadata } from "../thirteenF/fetch13F.js";
import { fetchRecent13FFilings } from "../thirteenF/fetch13F.js";
import { download13FInfoTableXml } from "../thirteenF/downloadInfoTable.js";
import { parse13FInformationTableXml } from "../thirteenF/parseInfoTable.js";
import {
  normalizeHoldingsFromInfoRows,
  toHoldingDbInserts,
} from "../thirteenF/normalizeHoldings.js";

export interface Ingest13FOptions {
  /** Display name stored on holdings (defaults to SEC filer name). */
  fundName?: string;
  ensureSchema?: boolean;
  /** Number of recent 13F-HR / 13F-HR/A filings to ingest (newest filing date first). */
  filingLimit?: number;
}

export interface IngestRecent13FResult {
  cik: string;
  filingsRequested: number;
  filingsProcessed: number;
  results: InsertFilingWithHoldingsResult[];
}

async function ingestOneFiling(
  filing: Latest13FFilingMetadata,
  fundName: string | undefined,
  ensureSchema: boolean
): Promise<InsertFilingWithHoldingsResult> {
  const { xml, documentName } = await download13FInfoTableXml(filing, { maxAttempts: 3 });
  const parsedRows = parse13FInformationTableXml(xml);
  const displayName = fundName?.trim() || filing.filerName || "Unknown fund";
  const normalized = normalizeHoldingsFromInfoRows(parsedRows, {
    fundName: displayName,
    filerCik: filing.filerCik,
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    reportPeriod: filing.reportDate,
  });
  const holdings = toHoldingDbInserts(normalized);

  const payload = toIngestPayload(
    {
      ...filing,
      infoTableDocument: documentName,
      holdingsCount: holdings.length,
    },
    holdings
  );

  const service = createHoldingsInsertService();
  if (ensureSchema) {
    await service.ensureSchema();
  }
  return service.insertFilingWithHoldings(payload);
}

/**
 * Fetch and persist the most recent N 13F-HR / 13F-HR/A filings for a filer CIK.
 * Each put, call, and common-stock line is stored separately (never merged).
 */
export async function ingestRecent13FForCik(
  cik: number | string,
  options: Ingest13FOptions = {}
): Promise<IngestRecent13FResult> {
  const limit = Math.max(1, Math.min(options.filingLimit ?? 8, 40));
  const { cik: paddedCik, filings } = await fetchRecent13FFilings({ cik, limit });

  if (!filings.length) {
    throw new Error(`No 13F-HR or 13F-HR/A filings found for CIK ${paddedCik}`);
  }

  const results: InsertFilingWithHoldingsResult[] = [];
  let ensureSchema = options.ensureSchema === true;

  for (const filing of filings) {
    const result = await ingestOneFiling(filing, options.fundName, ensureSchema);
    ensureSchema = false;
    results.push(result);
  }

  return {
    cik: paddedCik,
    filingsRequested: limit,
    filingsProcessed: results.length,
    results,
  };
}

/** Ingest only the single most recent 13F filing (backward compatible). */
export async function ingestLatest13FForCik(
  cik: number | string,
  options: Omit<Ingest13FOptions, "filingLimit"> = {}
): Promise<InsertFilingWithHoldingsResult> {
  const batch = await ingestRecent13FForCik(cik, { ...options, filingLimit: 1 });
  return batch.results[0];
}
