import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadEnvFile() {
  const p = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

let pool: pg.Pool | null = null;

export function getDatabaseUrl(): string {
  loadEnvFile();
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set (add to .env)");
  }
  return url;
}

function pgStatementTimeoutMs(): number {
  const raw = (process.env.PG_STATEMENT_TIMEOUT_MS || "120000").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 120_000;
}

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = getDatabaseUrl();
    const config: pg.PoolConfig = {
      connectionString,
      max: Number(process.env.PG_POOL_MAX || "10"),
      idleTimeoutMillis: 30_000,
    };
    if (/supabase\.co/i.test(connectionString)) {
      config.ssl = { rejectUnauthorized: false };
    }
    const timeoutMs = pgStatementTimeoutMs();
    if (timeoutMs > 0 && !/statement_timeout/i.test(connectionString)) {
      const sep = connectionString.includes("?") ? "&" : "?";
      config.connectionString = `${connectionString}${sep}options=${encodeURIComponent(
        `-c statement_timeout=${Math.floor(timeoutMs)}`
      )}`;
    }

    pool = new pg.Pool(config);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function verifyConnection(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
