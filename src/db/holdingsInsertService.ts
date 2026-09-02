import type pg from "pg";
import { getPool } from "./pool.js";
import {
  buildBatchInsertHoldingsSql,
  filingInsertParams,
  holdingInsertParams,
  INSERT_FILING_SQL,
  INSERT_HOLDING_SQL,
  SELECT_FILING_ID_BY_ACCESSION_SQL,
} from "./queries.js";

const HOLDINGS_INSERT_CHUNK = 250;
const INGEST_STATEMENT_TIMEOUT_MS = 600_000;
import type { IngestFilingPayload, InsertFilingWithHoldingsResult } from "./types.js";

export class HoldingsInsertService {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  /**
   * Persist one filing and its normalized holdings in a single transaction.
   * Skips holdings when the accession already exists (duplicate filing).
   */
  async insertFilingWithHoldings(
    payload: IngestFilingPayload
  ): Promise<InsertFilingWithHoldingsResult> {
    const { filing, holdings } = payload;
    const client = await this.pool.connect();

    try {
      // Pool default is often 120s; ingest needs longer (SEC parse + large holdings + lock wait).
      await client.query(`SET statement_timeout = ${INGEST_STATEMENT_TIMEOUT_MS}`);
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${INGEST_STATEMENT_TIMEOUT_MS}`);

      const filingResult = await client.query<{ id: string }>(
        INSERT_FILING_SQL,
        filingInsertParams(filing)
      );

      let duplicateFiling = false;
      let filingId: number;

      if (filingResult.rows.length === 0) {
        duplicateFiling = true;
        const existing = await client.query<{ id: string }>(
          SELECT_FILING_ID_BY_ACCESSION_SQL,
          [filing.accession_number]
        );
        if (!existing.rows.length) {
          throw new Error(
            `Filing conflict: accession ${filing.accession_number} missing after ON CONFLICT`
          );
        }
        filingId = Number(existing.rows[0].id);
        await client.query("COMMIT");
        return {
          filingId,
          accessionNumber: filing.accession_number,
          duplicateFiling: true,
          holdingsInserted: 0,
          holdingsSkipped: holdings.length,
        };
      }

      filingId = Number(filingResult.rows[0].id);
      let holdingsInserted = 0;
      let holdingsSkipped = 0;

      for (let i = 0; i < holdings.length; i += HOLDINGS_INSERT_CHUNK) {
        const chunk = holdings.slice(i, i + HOLDINGS_INSERT_CHUNK);
        if (chunk.length === 1) {
          const result = await client.query(
            INSERT_HOLDING_SQL,
            holdingInsertParams(filingId, chunk[0])
          );
          if ((result.rowCount ?? 0) > 0) holdingsInserted++;
          else holdingsSkipped++;
          continue;
        }

        const { sql, params } = buildBatchInsertHoldingsSql(filingId, chunk);
        const result = await client.query(sql, params);
        const inserted = result.rowCount ?? 0;
        holdingsInserted += inserted;
        holdingsSkipped += chunk.length - inserted;
      }

      await client.query("COMMIT");

      return {
        filingId,
        accessionNumber: filing.accession_number,
        duplicateFiling,
        holdingsInserted,
        holdingsSkipped,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Apply schema DDL from `sql/sec_holding_schema.sql`. */
  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SET statement_timeout = 0");
      const { loadHoldingsSchemaSql, loadHoldingsMigrateV2Sql } = await import("./schema.js");
      await client.query(loadHoldingsSchemaSql());
      await client.query(loadHoldingsMigrateV2Sql());
    } finally {
      client.release();
    }
  }
}

export function createHoldingsInsertService(pool?: pg.Pool): HoldingsInsertService {
  return new HoldingsInsertService(pool);
}
