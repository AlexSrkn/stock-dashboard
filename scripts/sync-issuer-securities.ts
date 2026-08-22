/**
 * Sync canonical issuers + security listings from seeds and stocks table.
 * Usage: npm run issuers:sync-securities
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { getIssuerRepository } from "../src/issuers/repository.js";

loadEnvFile();

const repo = getIssuerRepository();
await repo.ensureSchema();
const seeded = await repo.seedKnownGroups();
console.log(`Seeded ${seeded} known security listings.`);

const pg = getPool();
const stocks = await pg.query<{ ticker: string; company_name: string | null; cik: string | null }>(
  `SELECT ticker, company_name, cik FROM stocks WHERE company_name IS NOT NULL ORDER BY ticker`
);

let registered = 0;
for (const row of stocks.rows) {
  const ticker = String(row.ticker).toUpperCase();
  const existing = await repo.getListingByTicker(ticker);
  if (existing) continue;
  const name = String(row.company_name);
  const issuer = await repo.findOrCreateIssuerFromName(name, row.cik, ticker);
  await repo.upsertListing({
    ticker,
    issuerId: issuer.id,
    cik: row.cik,
    companyName: name,
    isPrimaryFiling: !issuer.primaryTicker || issuer.primaryTicker === ticker,
  });
  registered++;
}

console.log(`Registered ${registered} additional singleton listings from stocks table.`);
await closePool();
