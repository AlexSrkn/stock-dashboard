import { getFilingsFundamentals } from "../../sec/financials/financialsService.js";
import { calculateFcfYield } from "./calculate.js";
import { mapFilingsToFcfYieldInputs } from "./filingInputs.js";
import type {
  FcfYieldCalculateInputs,
  FcfYieldCalculateResult,
  FcfYieldInputsResponse,
} from "./types.js";

export class FcfYieldToolsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getFcfYieldInputs(tickerRaw: string): Promise<FcfYieldInputsResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new FcfYieldToolsError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }
  try {
    const fundamentals = await getFilingsFundamentals(ticker, {
      annualPeriodLimit: 6,
      quarterlyPeriodLimit: 8,
      annualFilingLimit: 8,
      quarterlyFilingLimit: 8,
      currentFilingLimit: 10,
    });
    return mapFilingsToFcfYieldInputs(fundamentals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      throw new FcfYieldToolsError(404, "not_found", `No SEC filing data found for ${ticker}.`);
    }
    throw err;
  }
}

export function runFcfYieldCalculate(body: unknown): FcfYieldCalculateResult {
  if (!body || typeof body !== "object") {
    throw new FcfYieldToolsError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return calculateFcfYield(body as FcfYieldCalculateInputs);
}
