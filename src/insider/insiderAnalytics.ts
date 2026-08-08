import type pg from "pg";
import { getPool } from "../db/pool.js";
import {
  queryInsiderTransactionsByTicker,
  queryRecentInsiderTransactions,
  type InsiderTransactionQueryOptions,
  type InsiderTransactionRow,
} from "../db/insiderTransactions.js";
import { lookupCikFromTicker } from "../sec/submissions.js";
import { formatSecCik } from "../sec/http.js";

export interface InsiderTransactionsMeta {
  ticker: string;
  cik: string | null;
  count: number;
  highSignalCount: number;
  lowSignalCount: number;
}

export interface InsiderTransactionsResponse {
  meta: InsiderTransactionsMeta;
  transactions: InsiderTransactionRow[];
}

export interface InsiderTransactionsApiOptions extends InsiderTransactionQueryOptions {}

export async function getInsiderTransactions(
  ticker: string,
  options: InsiderTransactionsApiOptions = {},
  pool: pg.Pool = getPool()
): Promise<InsiderTransactionsResponse> {
  const sym = String(ticker).trim().toUpperCase();
  let cik: string | null = null;
  try {
    cik = formatSecCik(await lookupCikFromTicker(sym));
  } catch {
    cik = null;
  }

  const transactions = await queryInsiderTransactionsByTicker(sym, options, pool);
  const highSignalCount = transactions.filter((t) => t.isHighSignal).length;
  const lowSignalCount = transactions.length - highSignalCount;

  return {
    meta: {
      ticker: sym,
      cik,
      count: transactions.length,
      highSignalCount,
      lowSignalCount,
    },
    transactions,
  };
}

export interface InsiderRecentResponse {
  fetchedAt: string;
  count: number;
  transactions: InsiderTransactionRow[];
}

export async function getRecentInsiderTransactions(
  options: InsiderTransactionQueryOptions = {},
  pool: pg.Pool = getPool()
): Promise<InsiderRecentResponse> {
  const transactions = await queryRecentInsiderTransactions(options, pool);
  return {
    fetchedAt: new Date().toISOString(),
    count: transactions.length,
    transactions,
  };
}
