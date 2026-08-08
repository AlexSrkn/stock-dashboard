/**
 * Apply Repeat Buyers indexes.
 * Usage: npx tsx scripts/apply-repeat-buyers-indexes.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "../sql/repeat_buyers_indexes.sql"), "utf8");
  const pool = getPool();
  try {
    await pool.query("SET statement_timeout = 0");
    await pool.query(sql);
    console.log("Repeat buyers indexes applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
