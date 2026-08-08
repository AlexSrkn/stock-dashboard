import { getFilingsFundamentals } from "../../sec/financials/financialsService.js";
import { calculateWacc } from "./calculate.js";
import { mapFilingsToWaccInputs } from "./filingInputs.js";
import type { WaccCalculateInputs, WaccCalculateResult, WaccInputsResponse } from "./types.js";

export class WaccToolsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getWaccInputs(tickerRaw: string): Promise<WaccInputsResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new WaccToolsError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }
  try {
    const fundamentals = await getFilingsFundamentals(ticker, {
      annualPeriodLimit: 6,
      quarterlyPeriodLimit: 8,
      annualFilingLimit: 8,
      quarterlyFilingLimit: 8,
      currentFilingLimit: 10,
    });
    return mapFilingsToWaccInputs(fundamentals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      throw new WaccToolsError(404, "not_found", `No SEC filing data found for ${ticker}.`);
    }
    throw err;
  }
}

export function runWaccCalculate(body: unknown): WaccCalculateResult {
  if (!body || typeof body !== "object") {
    throw new WaccToolsError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return calculateWacc(body as WaccCalculateInputs);
}
