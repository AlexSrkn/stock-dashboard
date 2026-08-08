/**

 * Apply Holder Overlap indexes.

 * Usage: npx tsx scripts/apply-holder-overlap-indexes.ts

 */

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";



loadEnvFile();



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sqlPath = path.join(__dirname, "..", "sql", "holder_overlap_indexes.sql");



function splitStatements(sql: string): string[] {

  return sql

    .split(";")

    .map((s) =>

      s

        .split("\n")

        .filter((line) => !line.trim().startsWith("--"))

        .join("\n")

        .trim()

    )

    .filter(Boolean);

}



async function main() {

  const pool = getPool();

  const client = await pool.connect();

  const statements = splitStatements(fs.readFileSync(sqlPath, "utf8"));

  console.log(`Applying ${statements.length} index statement(s)…`);

  try {

    await client.query("SET statement_timeout = 0");

    for (let i = 0; i < statements.length; i++) {

      const stmt = statements[i];

      const label = stmt.replace(/\s+/g, " ").slice(0, 80);

      process.stdout.write(`[${i + 1}/${statements.length}] ${label}… `);

      const t0 = Date.now();

      await client.query(stmt);

      console.log(`ok (${Date.now() - t0}ms)`);

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


