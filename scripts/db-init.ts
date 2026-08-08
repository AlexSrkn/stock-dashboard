/**
 * Create sec_filing + sec_holding tables.
 * Usage: npx tsx scripts/db-init.ts
 */
import { createHoldingsInsertService } from "../src/db/index.js";
import { getFinancialsRepository } from "../src/sec/financials/financialsRepository.js";
import { getStocksRepository } from "../src/stocks/stocksRepository.js";
import { getStockSignalsRepository } from "../src/stocks/stockSignalsRepository.js";
import { getPoliticiansRepository } from "../src/politicians/politiciansRepository.js";
import { ensureOwnershipSchema } from "../src/services/ownership/InstitutionDirectory.js";
import { loadEnvFile } from "../src/db/pool.js";

loadEnvFile();

const service = createHoldingsInsertService();
await service.ensureSchema();
try {
  await getFinancialsRepository().ensureSchema();
  await getStocksRepository().ensureSchema();
  await getStockSignalsRepository().ensureSchema();
  await ensureOwnershipSchema();
  try {
    await getPoliticiansRepository().ensureSchema();
  } catch {
    /* optional without DATABASE_URL */
  }
  console.log("Schema applied (sec_filing, sec_holding, sec_financial_period, sec_earnings_release, stocks, stock_signal, institution, ownership_cache, ownership_holding, politicians).");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("DATABASE_URL")) {
    console.log("Schema applied (sec_filing, sec_holding). Financials tables skipped (no DATABASE_URL).");
  } else {
    throw err;
  }
}
