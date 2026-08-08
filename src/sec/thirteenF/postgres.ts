import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  HoldingDbInsert,
  Sec13FFilingInsert,
  Sec13FFilingMeta,
  Sec13FHoldingInsert,
  Sec13FHoldingNormalized,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** PostgreSQL DDL for 13F filings and holdings (run once). */
export function load13FPostgresSchema(): string {
  return readFileSync(join(__dirname, "../../../sql/sec_13f_schema.sql"), "utf8");
}

export function toPostgresFilingRow(meta: Sec13FFilingMeta): Sec13FFilingInsert {
  return {
    filer_cik: meta.filerCik,
    filer_name: meta.filerName,
    accession_number: meta.accessionNumber,
    form_type: meta.formType,
    filing_date: meta.filingDate,
    report_period: meta.reportPeriod,
    info_table_document: meta.infoTableDocument,
    holdings_count: meta.holdingsCount,
  };
}

export function toPostgresHoldingRows(holdings: Sec13FHoldingNormalized[]): Sec13FHoldingInsert[] {
  return holdings.map((h) => ({
    filer_cik: h.filerCik,
    accession_number: h.accessionNumber,
    name_of_issuer: h.nameOfIssuer,
    title_of_class: h.titleOfClass,
    cusip: h.cusip,
    figi: h.figi,
    value_usd_thousands: h.valueUsdThousands,
    shares_or_principal_amount: h.sharesOrPrincipalAmount,
    shares_or_principal_type: h.sharesOrPrincipalType,
    investment_discretion: h.investmentDiscretion,
    put_call: h.putCall,
    other_manager: h.otherManager,
    voting_sole: h.votingSole,
    voting_shared: h.votingShared,
    voting_none: h.votingNone,
    row_hash: h.rowHash,
  }));
}

/** Parameterized INSERT for filings (use with pg client). */
export const INSERT_13F_FILING_SQL = `
INSERT INTO sec_13f_filing (
  filer_cik, filer_name, accession_number, form_type,
  filing_date, report_period, info_table_document, holdings_count
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (accession_number) DO UPDATE SET
  filer_name = EXCLUDED.filer_name,
  form_type = EXCLUDED.form_type,
  filing_date = EXCLUDED.filing_date,
  report_period = EXCLUDED.report_period,
  info_table_document = EXCLUDED.info_table_document,
  holdings_count = EXCLUDED.holdings_count,
  updated_at = NOW()
RETURNING id;
`.trim();

/** Parameterized INSERT for holdings (bind filing_id as $1). */
export const INSERT_13F_HOLDING_SQL = `
INSERT INTO sec_13f_holding (
  filing_id, filer_cik, accession_number, name_of_issuer, title_of_class,
  cusip, figi, value_usd_thousands, shares_or_principal_amount,
  shares_or_principal_type, investment_discretion, put_call, other_manager,
  voting_sole, voting_shared, voting_none, row_hash
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
)
ON CONFLICT (row_hash) DO NOTHING;
`.trim();

export function filingInsertParams(row: Sec13FFilingInsert): unknown[] {
  return [
    row.filer_cik,
    row.filer_name,
    row.accession_number,
    row.form_type,
    row.filing_date,
    row.report_period,
    row.info_table_document,
    row.holdings_count,
  ];
}

export function holdingInsertParams(filingId: number | string, row: Sec13FHoldingInsert): unknown[] {
  return [
    filingId,
    row.filer_cik,
    row.accession_number,
    row.name_of_issuer,
    row.title_of_class,
    row.cusip,
    row.figi,
    row.value_usd_thousands,
    row.shares_or_principal_amount,
    row.shares_or_principal_type,
    row.investment_discretion,
    row.put_call,
    row.other_manager,
    row.voting_sole,
    row.voting_shared,
    row.voting_none,
    row.row_hash,
  ];
}
