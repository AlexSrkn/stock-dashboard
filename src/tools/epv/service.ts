import { getFilingsFundamentals } from "../../sec/financials/financialsService.js";
import { calculateEPV } from "./calculate.js";
import { mapFilingsToEpvInputs } from "./filingInputs.js";
import type { EpvCalculateInputs, EpvCalculateResult, EpvInputsResponse } from "./types.js";

export class EpvToolsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getEpvInputs(tickerRaw: string): Promise<EpvInputsResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new EpvToolsError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }
  try {
    const fundamentals = await getFilingsFundamentals(ticker, {
      annualPeriodLimit: 8,
      quarterlyPeriodLimit: 8,
      annualFilingLimit: 8,
      quarterlyFilingLimit: 8,
      currentFilingLimit: 10,
    });
    return mapFilingsToEpvInputs(fundamentals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      throw new EpvToolsError(404, "not_found", `No SEC filing data found for ${ticker}.`);
    }
    throw err;
  }
}

export function runEpvCalculate(body: unknown): EpvCalculateResult {
  if (!body || typeof body !== "object") {
    throw new EpvToolsError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return calculateEPV(body as EpvCalculateInputs);
}
