import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
loadEnvFile();
const pool = getPool();
const r = await pool.query(
  "SELECT type, count(*)::int AS n FROM institution GROUP BY type ORDER BY n DESC"
);
console.log(r.rows);
await closePool();
