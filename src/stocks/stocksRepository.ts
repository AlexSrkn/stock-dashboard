import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadStocksSchemaSql } from "../db/schema.js";

export interface StockRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  sic: string | null;
  sicDescription: string | null;
  cik: string | null;
  updatedAt: string;
}

export interface UpsertStockInput {
  ticker: string;
  companyName?: string | null;
  sector?: string | null;
  industry?: string | null;
  sic?: string | null;
  sicDescription?: string | null;
  cik?: string | null;
}

const UPSERT_SQL = `
INSERT INTO stocks (
  ticker, company_name, sector, industry, sic, sic_description, cik, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
ON CONFLICT (ticker) DO UPDATE SET
  company_name = COALESCE(EXCLUDED.company_name, stocks.company_name),
  sector = COALESCE(EXCLUDED.sector, stocks.sector),
  industry = COALESCE(EXCLUDED.industry, stocks.industry),
  sic = COALESCE(EXCLUDED.sic, stocks.sic),
  sic_description = COALESCE(EXCLUDED.sic_description, stocks.sic_description),
  cik = COALESCE(EXCLUDED.cik, stocks.cik),
  updated_at = NOW()
`.trim();

function mapRow(row: {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  sic: string | null;
  sic_description: string | null;
  cik: string | null;
  updated_at: string | Date;
}): StockRow {
  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at);
  return {
    ticker: String(row.ticker || "").toUpperCase(),
    companyName: row.company_name,
    sector: row.sector,
    industry: row.industry,
    sic: row.sic,
    sicDescription: row.sic_description,
    cik: row.cik,
    updatedAt,
  };
}

export class StocksRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(loadStocksSchemaSql());
  }

  async upsert(input: UpsertStockInput): Promise<void> {
    const ticker = String(input.ticker || "")
      .trim()
      .toUpperCase();
    if (!ticker) return;
    await this.pool.query(UPSERT_SQL, [
      ticker,
      input.companyName ?? null,
      input.sector ?? null,
      input.industry ?? null,
      input.sic ?? null,
      input.sicDescription ?? null,
      input.cik ?? null,
    ]);
  }

  async getByTicker(ticker: string): Promise<StockRow | null> {
    const sym = String(ticker || "")
      .trim()
      .toUpperCase();
    if (!sym) return null;
    const res = await this.pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
      industry: string | null;
      sic: string | null;
      sic_description: string | null;
      cik: string | null;
      updated_at: string | Date;
    }>(
      `SELECT ticker, company_name, sector, industry, sic, sic_description, cik, updated_at
       FROM stocks WHERE ticker = $1`,
      [sym]
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async listSectors(): Promise<Array<{ sector: string; count: number }>> {
    const res = await this.pool.query<{ sector: string; count: string }>(
      `SELECT sector, COUNT(*)::text AS count
       FROM stocks
       WHERE sector IS NOT NULL AND BTRIM(sector) <> ''
       GROUP BY sector
       ORDER BY sector ASC`
    );
    return res.rows.map((r) => ({
      sector: r.sector,
      count: Number(r.count),
    }));
  }

  async listTickersNeedingRefresh(limit = 500): Promise<string[]> {
    const res = await this.pool.query<{ ticker: string }>(
      `SELECT ticker FROM stocks
       WHERE sic IS NULL OR sector IS NULL
       ORDER BY updated_at ASC
       LIMIT $1`,
      [Math.max(1, limit)]
    );
    return res.rows.map((r) => r.ticker);
  }
}

let defaultRepo: StocksRepository | null = null;

export function getStocksRepository(): StocksRepository {
  if (!defaultRepo) defaultRepo = new StocksRepository();
  return defaultRepo;
}
