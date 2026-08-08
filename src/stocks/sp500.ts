import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Sp500Stock {
  symbol: string;
  name: string;
}

export interface Sp500Payload {
  updatedAt: string;
  count: number;
  stocks: Sp500Stock[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SP500_PATH = path.join(__dirname, "../../data/sp500.json");

let cached: Sp500Payload | null = null;

export function loadSp500(): Sp500Payload {
  if (cached) return cached;
  const raw = fs.readFileSync(SP500_PATH, "utf8");
  const parsed = JSON.parse(raw) as Sp500Payload;
  cached = {
    updatedAt: parsed.updatedAt || new Date().toISOString(),
    count: parsed.count ?? parsed.stocks?.length ?? 0,
    stocks: Array.isArray(parsed.stocks)
      ? parsed.stocks.map((s) => ({
          symbol: String(s.symbol || "").trim().toUpperCase(),
          name: String(s.name || s.symbol || "").trim(),
        }))
      : [],
  };
  return cached;
}
