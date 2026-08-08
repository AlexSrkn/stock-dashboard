import { getFilingsFundamentals } from "../../sec/financials/financialsService.js";
import { calculatePeValuation } from "./calculate.js";
import { mapFilingsToPeInputs } from "./filingInputs.js";
import type { PeCalculateInputs, PeCalculateResult, PeInputsResponse } from "./types.js";

export class PeToolsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getPeInputs(tickerRaw: string): Promise<PeInputsResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new PeToolsError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }
  try {
    const fundamentals = await getFilingsFundamentals(ticker, {
      annualPeriodLimit: 6,
      quarterlyPeriodLimit: 8,
      annualFilingLimit: 8,
      quarterlyFilingLimit: 8,
      currentFilingLimit: 10,
    });
    return mapFilingsToPeInputs(fundamentals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      throw new PeToolsError(404, "not_found", `No SEC filing data found for ${ticker}.`);
    }
    throw err;
  }
}

export function runPeCalculate(body: unknown): PeCalculateResult {
  if (!body || typeof body !== "object") {
    throw new PeToolsError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return calculatePeValuation(body as PeCalculateInputs);
}
