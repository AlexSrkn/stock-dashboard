import type { HoldingDbInsert } from "../sec/thirteenF/types.js";

/** Parameterized SQL for holdings persistence (no SEC logic). */

export const INSERT_FILING_SQL = `
INSERT INTO sec_filing (
  filer_cik, accession_number, fund_name, form_type,
  filing_date, report_period, quarter, info_table_document, holdings_count, total_value
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (accession_number) DO NOTHING
RETURNING id;
`.trim();

export const SELECT_FILING_ID_BY_ACCESSION_SQL = `
SELECT id FROM sec_filing WHERE accession_number = $1;
`.trim();

export const INSERT_HOLDING_SQL = `
INSERT INTO sec_holding (
  filing_id, filer_cik, accession_number, fund_name, issuer, cusip, ticker,
  shares, value, value_usd_thousands, filing_date, quarter,
  put_call, shares_type, security_type, option_type, discretion, title_of_class, row_hash
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
)
ON CONFLICT (row_hash) DO NOTHING;
`.trim();

const HOLDING_INSERT_COLUMN_COUNT = 19;

export function filingInsertParams(filing: {
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
}): unknown[] {
  return [
    filing.filer_cik,
    filing.accession_number,
    filing.fund_name,
    filing.form_type,
    filing.filing_date,
    filing.report_period,
    filing.quarter,
    filing.info_table_document,
    filing.holdings_count,
    filing.total_value,
  ];
}

export function buildBatchInsertHoldingsSql(
  filingId: number,
  rows: HoldingDbInsert[]
): { sql: string; params: unknown[] } {
  if (!rows.length) {
    throw new Error("buildBatchInsertHoldingsSql requires at least one row");
  }

  const valueGroups: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const row of rows) {
    const rowParams = holdingInsertParams(filingId, row);
    const placeholders = Array.from(
      { length: HOLDING_INSERT_COLUMN_COUNT },
      () => `$${paramIndex++}`
    ).join(", ");
    valueGroups.push(`(${placeholders})`);
    params.push(...rowParams);
  }

  const sql = `
INSERT INTO sec_holding (
  filing_id, filer_cik, accession_number, fund_name, issuer, cusip, ticker,
  shares, value, value_usd_thousands, filing_date, quarter,
  put_call, shares_type, security_type, option_type, discretion, title_of_class, row_hash
) VALUES ${valueGroups.join(", ")}
ON CONFLICT (row_hash) DO NOTHING;
`.trim();

  return { sql, params };
}

export function holdingInsertParams(filingId: number, row: HoldingDbInsert): unknown[] {
  return [
    filingId,
    row.filer_cik,
    row.accession_number,
    row.fund_name,
    row.issuer,
    row.cusip,
    row.ticker,
    row.shares,
    row.value,
    row.value_usd_thousands,
    row.filing_date,
    row.quarter,
    row.put_call,
    row.shares_type,
    row.security_type,
    row.option_type,
    row.discretion,
    row.title_of_class,
    row.row_hash,
  ];
}
