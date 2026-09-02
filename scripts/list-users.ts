import { loadEnvFile, getPool, closePool } from "../src/db/pool.js";

loadEnvFile();
const pool = getPool();
const res = await pool.query(
  `SELECT id, email, display_name FROM app_user ORDER BY id DESC LIMIT 10`
);
console.log(JSON.stringify(res.rows, null, 2));
await closePool();
