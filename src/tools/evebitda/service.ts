import { getFilingsFundamentals } from "../../sec/financials/financialsService.js";
import { calculateEvEbitdaValuation } from "./calculate.js";
import { mapFilingsToEvEbitdaInputs } from "./filingInputs.js";
import type {
  EvEbitdaCalculateInputs,
  EvEbitdaCalculateResult,
  EvEbitdaInputsResponse,
} from "./types.js";

export class EvEbitdaToolsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getEvEbitdaInputs(tickerRaw: string): Promise<EvEbitdaInputsResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new EvEbitdaToolsError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }
  try {
    const fundamentals = await getFilingsFundamentals(ticker, {
      annualPeriodLimit: 6,
      quarterlyPeriodLimit: 8,
      annualFilingLimit: 8,
      quarterlyFilingLimit: 8,
      currentFilingLimit: 10,
    });
    return mapFilingsToEvEbitdaInputs(fundamentals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      throw new EvEbitdaToolsError(404, "not_found", `No SEC filing data found for ${ticker}.`);
    }
    throw err;
  }
}

export function runEvEbitdaCalculate(body: unknown): EvEbitdaCalculateResult {
  if (!body || typeof body !== "object") {
    throw new EvEbitdaToolsError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return calculateEvEbitdaValuation(body as EvEbitdaCalculateInputs);
}
