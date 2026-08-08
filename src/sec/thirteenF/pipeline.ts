import { downloadSecSubmissionsJson } from "../submissions.js";
import { discover13FFilings } from "./discover.js";
import { download13FInfoTableXml } from "./downloadInfoTable.js";
import { normalize13FHoldings } from "./normalize.js";
import { parse13FInformationTableXml } from "./parseInfoTable.js";
import { toPostgresFilingRow, toPostgresHoldingRows } from "./postgres.js";
import type { Fetch13FFilingsOptions, Sec13FIngestResult, Sec13FFilingMeta } from "./types.js";

/**
 * Fetch, parse, normalize, and prepare 13F holdings for PostgreSQL.
 *
 * Note: 13F-HR is filed by institutional managers (filer CIK), not by issuers.
 */
export async function fetchAndNormalize13FFilings(
  options: Fetch13FFilingsOptions
): Promise<Sec13FIngestResult[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 5, 40));
  const fetchOpts = { userAgent: options.userAgent, fetch: options.fetch };

  const submissions = await downloadSecSubmissionsJson({
    cik: options.filerCik,
    ...fetchOpts,
  });

  const filingRefs = discover13FFilings(submissions, limit);
  const results: Sec13FIngestResult[] = [];

  for (const filing of filingRefs) {
    const { documentName, xml } = await download13FInfoTableXml(filing, fetchOpts);
    const parsed = parse13FInformationTableXml(xml);
    const holdings = normalize13FHoldings(filing, documentName, parsed);

    const meta: Sec13FFilingMeta = {
      filerCik: filing.filerCik,
      filerName: filing.filerName,
      accessionNumber: filing.accessionNumber,
      formType: filing.formType,
      filingDate: filing.filingDate,
      reportPeriod: filing.reportDate,
      infoTableDocument: documentName,
      holdingsCount: holdings.length,
    };

    results.push({
      filing: meta,
      holdings,
      postgres: {
        filing: toPostgresFilingRow(meta),
        holdings: toPostgresHoldingRows(holdings),
      },
    });
  }

  return results;
}
