import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadFinancialsSchemaSql } from "../../db/schema.js";
import { is10KForm, is10QForm, isValidFilingDate, parseIsoDate } from "./periodUtils.js";
import type { EarningsReleaseRow, FinancialPeriodRow } from "./types.js";

export interface PersistFinancialsInput {
  cik: string;
  ticker: string;
  issuerId?: number | null;
  annual: FinancialPeriodRow[];
  quarterly: FinancialPeriodRow[];
  earningsReleases: EarningsReleaseRow[];
  knownAccessions: Set<string>;
}

const UPSERT_PERIOD_SQL = `
INSERT INTO sec_financial_period (
  cik, ticker, issuer_id, fiscal_year, fiscal_period, period_end, form_type, filed_date,
  accession_number, statement_scope, metrics, metric_sources, derived_metrics, data_source
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14)
ON CONFLICT (cik, fiscal_year, fiscal_period, statement_scope)
DO UPDATE SET
  ticker = EXCLUDED.ticker,
  issuer_id = COALESCE(EXCLUDED.issuer_id, sec_financial_period.issuer_id),
  period_end = EXCLUDED.period_end,
  form_type = EXCLUDED.form_type,
  filed_date = EXCLUDED.filed_date,
  accession_number = EXCLUDED.accession_number,
  metrics = EXCLUDED.metrics,
  metric_sources = EXCLUDED.metric_sources,
  derived_metrics = EXCLUDED.derived_metrics,
  data_source = EXCLUDED.data_source,
  ingested_at = NOW()
WHERE EXCLUDED.filed_date >= sec_financial_period.filed_date
`.trim();

const UPSERT_EARNINGS_SQL = `
INSERT INTO sec_earnings_release (
  cik, ticker, accession_number, filing_date, period_end, items, metrics, metric_sources
) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
ON CONFLICT (accession_number)
DO UPDATE SET
  metrics = EXCLUDED.metrics,
  metric_sources = EXCLUDED.metric_sources,
  ingested_at = NOW()
`.trim();

function validatePeriodRow(
  row: FinancialPeriodRow,
  scope: "annual" | "quarterly",
  knownAccessions: Set<string>
): string | null {
  const end = parseIsoDate(row.end);
  const filed = parseIsoDate(row.filed);
  if (!end || !filed) return "missing period or filed date";
  if (!isValidFilingDate(end, filed)) return "filed date before period end";
  if (scope === "annual" && !is10KForm(row.form)) return "annual row must be 10-K/20-F/40-F";
  if (scope === "quarterly" && !is10QForm(row.form)) return "quarterly row must be 10-Q/6-K";
  if (row.accessionNumber && !knownAccessions.has(row.accessionNumber)) {
    if (!row.inclusionReason?.includes("6-K exhibit")) {
      return `unknown accession ${row.accessionNumber}`;
    }
  }
  if (!row.fy || !row.fp) return "missing fiscal year or period";
  return null;
}

export class FinancialsRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(loadFinancialsSchemaSql());
  }

  async persistValidated(input: PersistFinancialsInput): Promise<{ periods: number; releases: number; skipped: number }> {
    await this.ensureSchema();
    let periods = 0;
    let releases = 0;
    let skipped = 0;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const [scope, rows] of [
        ["annual", input.annual] as const,
        ["quarterly", input.quarterly] as const,
      ]) {
        for (const row of rows) {
          const err = validatePeriodRow(row, scope, input.knownAccessions);
          if (err) {
            skipped++;
            continue;
          }
          await client.query(UPSERT_PERIOD_SQL, [
            input.cik,
            input.ticker,
            input.issuerId ?? null,
            row.fy,
            row.fp,
            row.end,
            row.form,
            row.filed,
            row.accessionNumber,
            scope,
            JSON.stringify(row.metrics),
            JSON.stringify(row.metricSources),
            JSON.stringify(row.derived ?? {}),
            row.inclusionReason?.includes("6-K exhibit") ? "6k-exhibit" : "companyfacts",
          ]);
          periods++;
        }
      }

      for (const release of input.earningsReleases) {
        const filed = parseIsoDate(release.filingDate);
        if (!filed) {
          skipped++;
          continue;
        }
        if (!input.knownAccessions.has(release.accessionNumber)) {
          skipped++;
          continue;
        }
        await client.query(UPSERT_EARNINGS_SQL, [
          input.cik,
          input.ticker,
          release.accessionNumber,
          filed,
          parseIsoDate(release.reportDate),
          release.items,
          JSON.stringify(release.metrics),
          JSON.stringify(release.metricSources),
        ]);
        releases++;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return { periods, releases, skipped };
  }
}

let defaultRepo: FinancialsRepository | null = null;

export function getFinancialsRepository(): FinancialsRepository {
  if (!defaultRepo) defaultRepo = new FinancialsRepository();
  return defaultRepo;
}

export async function tryPersistFinancials(input: PersistFinancialsInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await getFinancialsRepository().persistValidated(input);
  } catch {
    // Non-fatal: live SEC response still returned to client.
  }
}
