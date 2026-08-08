import type { Sec13FFilingRef, Sec13FHoldingNormalized, Sec13FInfoTableRow } from "./types.js";
import {
  buildHoldingRowHash,
  normalizeHoldingsFromInfoRows,
  normalizeOptionalNumber,
  normalizeOptionalString,
  normalizeRequiredString,
} from "./normalizeHoldings.js";

export { buildHoldingRowHash };

export function normalize13FHoldings(
  filing: Sec13FFilingRef,
  infoTableDocument: string,
  rows: Sec13FInfoTableRow[]
): Sec13FHoldingNormalized[] {
  const records = normalizeHoldingsFromInfoRows(rows, {
    fundName: filing.filerName,
    filerCik: filing.filerCik,
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    reportPeriod: filing.reportDate,
  });

  return records.map((rec, i) => {
    const row = rows[i];
    return {
      nameOfIssuer: rec.issuer,
      titleOfClass: normalizeRequiredString(row?.titleOfClass),
      cusip: rec.cusip,
      figi: normalizeOptionalString(row?.figi, 12),
      valueUsdThousands: rec.value,
      sharesOrPrincipalAmount: rec.shares,
      sharesOrPrincipalType: rec.sharesType,
      investmentDiscretion: normalizeOptionalString(row?.investmentDiscretion, 8),
      putCall: rec.putCall,
      otherManager: normalizeOptionalString(row?.otherManager, 32),
      votingSole: normalizeOptionalNumber(row?.votingSole),
      votingShared: normalizeOptionalNumber(row?.votingShared),
      votingNone: normalizeOptionalNumber(row?.votingNone),
      filerCik: rec.filerCik,
      filerName: rec.fundName,
      accessionNumber: rec.accessionNumber,
      formType: filing.formType,
      filingDate: rec.filingDate,
      reportPeriod: filing.reportDate,
      infoTableDocument,
      rowHash: rec.rowHash,
    };
  });
}
