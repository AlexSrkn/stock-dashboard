import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../../db/pool.js";
import type { ThirteenFInfoManagerCandidate } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadThirteenFManagerCandidatesSchemaSql(): string {
  return fs.readFileSync(
    path.join(__dirname, "../../../sql/thirteen_f_manager_candidates_schema.sql"),
    "utf8"
  );
}

export async function ensureThirteenFManagerCandidatesSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(loadThirteenFManagerCandidatesSchemaSql());
}

/**
 * Replace the entire staging candidate snapshot.
 * Does not touch the live `institution` table.
 */
export async function upsertThirteenFManagerCandidates(
  candidates: ThirteenFInfoManagerCandidate[],
  {
    minimumQuarter,
    scrapedAt,
  }: { minimumQuarter: string; scrapedAt: string }
): Promise<number> {
  await ensureThirteenFManagerCandidatesSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM thirteen_f_manager_candidates`);

    let written = 0;
    for (const row of candidates) {
      await client.query(
        `INSERT INTO thirteen_f_manager_candidates (
           id, manager_name, location, latest_filing_quarter, latest_filing_date,
           source_url, source, minimum_quarter, scraped_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [
          row.id,
          row.manager_name,
          row.location,
          row.latest_filing_quarter,
          row.latest_filing_date,
          row.source_url,
          row.source,
          minimumQuarter,
          scrapedAt,
        ]
      );
      written += 1;
    }
    await client.query("COMMIT");
    return written;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
