/**
 * Apply performance indexes (pg_trgm + composite) without re-ingesting data.
 *
 * Usage: npx tsx scripts/apply-db-indexes.ts
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { loadHoldingsPerformanceStatements } from "../src/db/schema.js";

loadEnvFile();

async function main() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("SET statement_timeout = 0");
    const statements = loadHoldingsPerformanceStatements();
    console.log(`Applying ${statements.length} DDL statement(s)…`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const label = stmt.split("\n")[0].slice(0, 72);
      process.stdout.write(`[${i + 1}/${statements.length}] ${label}… `);
      const started = Date.now();
      await client.query(stmt);
      console.log(`ok (${Math.round((Date.now() - started) / 1000)}s)`);
    }

    console.log("Done.");
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
