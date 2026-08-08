import { getFilingsFundamentals } from "../../sec/financials/financialsService.js";
import { calculateEnterpriseValue } from "./calculate.js";
import { mapFilingsToEvInputs } from "./filingInputs.js";
import type { EvCalculateInputs, EvCalculateResult, EvInputsResponse } from "./types.js";

export class EvToolsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getEvInputs(tickerRaw: string): Promise<EvInputsResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new EvToolsError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }
  try {
    const fundamentals = await getFilingsFundamentals(ticker, {
      annualPeriodLimit: 6,
      quarterlyPeriodLimit: 8,
      annualFilingLimit: 8,
      quarterlyFilingLimit: 8,
      currentFilingLimit: 10,
    });
    return mapFilingsToEvInputs(fundamentals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      throw new EvToolsError(404, "not_found", `No SEC filing data found for ${ticker}.`);
    }
    throw err;
  }
}

export function runEvCalculate(body: unknown): EvCalculateResult {
  if (!body || typeof body !== "object") {
    throw new EvToolsError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return calculateEnterpriseValue(body as EvCalculateInputs);
}
