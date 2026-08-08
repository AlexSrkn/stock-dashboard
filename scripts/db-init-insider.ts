/**
 * Create insider_transaction table.
 * Usage: npx tsx scripts/db-init-insider.ts
 */
import { ensureInsiderTransactionsSchema } from "../src/db/insiderTransactions.js";
import { loadEnvFile } from "../src/db/pool.js";

loadEnvFile();
await ensureInsiderTransactionsSchema();
console.log("Schema applied (insider_transaction).");
