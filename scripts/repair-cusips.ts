/**
 * Normalize stored CUSIPs (leading zeros; fixes CHAR(9) padding mismatches).
 * Usage: npx tsx scripts/repair-cusips.ts
 */
import { getPool, closePool } from "../src/db/pool.js";
import { normalizeCusip } from "../src/sec/thirteenF/normalizeHoldings.js";

const pool = getPool();
const res = await pool.query<{ id: string; cusip: string }>(
  "SELECT id, cusip FROM sec_holding"
);
let updated = 0;
for (const row of res.rows) {
  const next = normalizeCusip(String(row.cusip).trim());
  if (!next || next === String(row.cusip).trim()) continue;
  await pool.query("UPDATE sec_holding SET cusip = $1 WHERE id = $2", [next, row.id]);
  updated++;
}
console.log(`Repaired ${updated} of ${res.rows.length} holding row(s).`);
await closePool();
