import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { getPool } from "./pool.js";
import { form4RowHash } from "../sec/form4/findDocument.js";
import type { ParsedForm4Transaction } from "../sec/form4/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface InsiderTransactionInsert {
  cik: string;
  ticker: string | null;
  accessionNumber: string;
  rowHash: string;
  insiderName: string;
  insiderTitle: string | null;
  filingDate: string | null;
  transactionDate: string | null;
  transactionCode: string;
  acquisitionDisposition: string | null;
  shares: number | null;
  pricePerShare: number | null;
  transactionValue: number | null;
  ownershipNature: string | null;
  securityTitle: string | null;
  isDerivative: boolean;
  isHighSignal: boolean;
}

export function loadInsiderTransactionsSchemaSql(): string {
  return fs.readFileSync(
    path.join(__dirname, "../../sql/insider_transactions_schema.sql"),
    "utf8"
  );
}

export async function ensureInsiderTransactionsSchema(pool: pg.Pool = getPool()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query(loadInsiderTransactionsSchemaSql());
  } finally {
    client.release();
  }
}

export function toInsiderInsert(
  cik: string,
  ticker: string | null,
  accessionNumber: string,
  row: ParsedForm4Transaction
): InsiderTransactionInsert {
  return {
    cik,
    ticker,
    accessionNumber,
    rowHash: form4RowHash(accessionNumber, row.rowKey),
    insiderName: row.insiderName,
    insiderTitle: row.insiderTitle,
    filingDate: row.filingDate,
    transactionDate: row.transactionDate,
    transactionCode: row.transactionCode,
    acquisitionDisposition: row.acquisitionDisposition,
    shares: row.shares,
    pricePerShare: row.pricePerShare,
    transactionValue: row.transactionValue,
    ownershipNature: row.ownershipNature,
    securityTitle: row.securityTitle,
    isDerivative: row.isDerivative,
    isHighSignal: row.isHighSignal,
  };
}

const INSERT_SQL = `
INSERT INTO insider_transaction (
  cik, ticker, accession_number, row_hash,
  insider_name, insider_title, filing_date, transaction_date,
  transaction_code, acquisition_disposition, shares, price_per_share,
  transaction_value, ownership_nature, security_title, is_derivative, is_high_signal
) VALUES (
  $1, $2, $3, $4,
  $5, $6, $7, $8,
  $9, $10, $11, $12,
  $13, $14, $15, $16, $17
)
ON CONFLICT (row_hash) DO NOTHING
`;

export async function insertInsiderTransactions(
  rows: InsiderTransactionInsert[],
  pool: pg.Pool = getPool()
): Promise<{ inserted: number; skipped: number }> {
  if (!rows.length) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await pool.query(INSERT_SQL, [
      r.cik,
      r.ticker,
      r.accessionNumber,
      r.rowHash,
      r.insiderName,
      r.insiderTitle,
      r.filingDate,
      r.transactionDate,
      r.transactionCode,
      r.acquisitionDisposition,
      r.shares,
      r.pricePerShare,
      r.transactionValue,
      r.ownershipNature,
      r.securityTitle,
      r.isDerivative,
      r.isHighSignal,
    ]);
    if ((res.rowCount ?? 0) > 0) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

export interface InsiderTransactionQueryOptions {
  limit?: number;
  signal?: "high" | "low" | "all";
  codes?: string[];
  role?: "ceo" | "director" | "officer" | "all";
  sort?: "date" | "value";
}

export interface InsiderTransactionRow {
  id: number;
  cik: string;
  ticker: string | null;
  accessionNumber: string;
  insiderName: string;
  insiderTitle: string | null;
  filingDate: string | null;
  transactionDate: string | null;
  transactionCode: string;
  acquisitionDisposition: string | null;
  shares: number | null;
  pricePerShare: number | null;
  transactionValue: number | null;
  ownershipNature: string | null;
  securityTitle: string | null;
  isDerivative: boolean;
  isHighSignal: boolean;
}

export async function queryInsiderTransactionsByTicker(
  ticker: string,
  options: InsiderTransactionQueryOptions = {},
  pool: pg.Pool = getPool()
): Promise<InsiderTransactionRow[]> {
  const sym = String(ticker).trim().toUpperCase();
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const conditions = ["upper(ticker) = $1"];
  const params: unknown[] = [sym];
  let p = 2;

  if (options.signal === "high") {
    conditions.push("is_high_signal = true");
  } else if (options.signal === "low") {
    conditions.push("is_high_signal = false");
  }

  if (options.codes?.length) {
    const codes = options.codes.map((c) => c.toUpperCase());
    conditions.push(`upper(transaction_code) = ANY($${p}::text[])`);
    params.push(codes);
    p++;
  }

  if (options.role === "ceo") {
    conditions.push(`(insider_title ILIKE '%CEO%' OR insider_title ILIKE '%chief executive%')`);
  } else if (options.role === "director") {
    conditions.push(`insider_title ILIKE '%director%'`);
  } else if (options.role === "officer") {
    conditions.push(
      `(insider_title ILIKE '%officer%' OR insider_title ILIKE '%president%' OR insider_title ILIKE '%cfo%' OR insider_title ILIKE '%coo%')`
    );
  }

  const orderBy =
    options.sort === "value"
      ? "transaction_value DESC NULLS LAST, transaction_date DESC NULLS LAST"
      : "transaction_date DESC NULLS LAST, filing_date DESC NULLS LAST";

  params.push(limit);
  const sql = `
    SELECT
      id, cik, ticker, accession_number AS "accessionNumber",
      insider_name AS "insiderName", insider_title AS "insiderTitle",
      filing_date::text AS "filingDate", transaction_date::text AS "transactionDate",
      transaction_code AS "transactionCode",
      acquisition_disposition AS "acquisitionDisposition",
      shares::float8 AS shares, price_per_share::float8 AS "pricePerShare",
      transaction_value::float8 AS "transactionValue",
      ownership_nature AS "ownershipNature", security_title AS "securityTitle",
      is_derivative AS "isDerivative", is_high_signal AS "isHighSignal"
    FROM insider_transaction
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $${p}
  `;

  const res = await pool.query<InsiderTransactionRow>(sql, params);
  return res.rows;
}

export async function queryRecentInsiderTransactions(
  options: InsiderTransactionQueryOptions = {},
  pool: pg.Pool = getPool()
): Promise<InsiderTransactionRow[]> {
  const limit = Math.min(1000, Math.max(1, options.limit ?? 500));
  const conditions = ["ticker IS NOT NULL", "trim(ticker) <> ''"];
  const params: unknown[] = [];
  let p = 1;

  if (options.signal === "high") {
    conditions.push("is_high_signal = true");
  } else if (options.signal === "low") {
    conditions.push("is_high_signal = false");
  }

  if (options.codes?.length) {
    const codes = options.codes.map((c) => c.toUpperCase());
    conditions.push(`upper(transaction_code) = ANY($${p}::text[])`);
    params.push(codes);
    p++;
  }

  if (options.role === "ceo") {
    conditions.push(`(insider_title ILIKE '%CEO%' OR insider_title ILIKE '%chief executive%')`);
  } else if (options.role === "director") {
    conditions.push(`insider_title ILIKE '%director%'`);
  } else if (options.role === "officer") {
    conditions.push(
      `(insider_title ILIKE '%officer%' OR insider_title ILIKE '%president%' OR insider_title ILIKE '%cfo%' OR insider_title ILIKE '%coo%')`
    );
  }

  const orderBy =
    options.sort === "value"
      ? "transaction_value DESC NULLS LAST, transaction_date DESC NULLS LAST"
      : "transaction_date DESC NULLS LAST, filing_date DESC NULLS LAST";

  params.push(limit);
  const sql = `
    SELECT
      id, cik, ticker, accession_number AS "accessionNumber",
      insider_name AS "insiderName", insider_title AS "insiderTitle",
      filing_date::text AS "filingDate", transaction_date::text AS "transactionDate",
      transaction_code AS "transactionCode",
      acquisition_disposition AS "acquisitionDisposition",
      shares::float8 AS shares, price_per_share::float8 AS "pricePerShare",
      transaction_value::float8 AS "transactionValue",
      ownership_nature AS "ownershipNature", security_title AS "securityTitle",
      is_derivative AS "isDerivative", is_high_signal AS "isHighSignal"
    FROM insider_transaction
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $${p}
  `;

  const res = await pool.query<InsiderTransactionRow>(sql, params);
  return res.rows;
}
