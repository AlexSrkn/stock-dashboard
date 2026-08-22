import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadHoldingsSchemaSql(): string {
  return fs.readFileSync(path.join(__dirname, "../../sql/sec_holding_schema.sql"), "utf8");
}

export function loadHoldingsPerformanceSql(): string {
  return fs.readFileSync(
    path.join(__dirname, "../../sql/sec_holding_performance.sql"),
    "utf8"
  );
}

/** Run performance DDL one statement at a time (index builds can take several minutes). */
export function loadHoldingsPerformanceStatements(): string[] {
  return loadHoldingsPerformanceSql()
    .split(";")
    .map((s) => s.replace(/^\s*--[^\n]*\n?/gm, "").trim())
    .filter((s) => s.length > 0);
}

export function loadHoldingsMigrateV2Sql(): string {
  return fs.readFileSync(
    path.join(__dirname, "../../sql/sec_holding_migrate_v2.sql"),
    "utf8"
  );
}

export function loadFinancialsSchemaSql(): string {
  return fs.readFileSync(path.join(__dirname, "../../sql/sec_financials_schema.sql"), "utf8");
}

export function loadStocksSchemaSql(): string {
  return fs.readFileSync(path.join(__dirname, "../../sql/stocks_schema.sql"), "utf8");
}

export function loadStockSignalsSchemaSql(): string {
  return fs.readFileSync(path.join(__dirname, "../../sql/stock_signals_schema.sql"), "utf8");
}

export function loadOwnershipCacheSchemaSql(): string {
  return fs.readFileSync(path.join(__dirname, "../../sql/ownership_cache_schema.sql"), "utf8");
}

export function loadPoliticiansSchemaSql(): string {
  return fs.readFileSync(path.join(__dirname, "../../sql/politicians_schema.sql"), "utf8");
}

export function loadIssuerSecuritiesSchemaSql(): string {
  return fs.readFileSync(path.join(__dirname, "../../sql/issuer_securities_schema.sql"), "utf8");
}
