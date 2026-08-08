import { getFilingsFundamentals } from "../../sec/financials/financialsService.js";
import { calculateDCF } from "./calculate.js";
import { mapFilingsToDcfInputs } from "./filingInputs.js";
import type { DcfCalculateInputs, DcfCalculateResult, DcfFilingInputsResponse } from "./types.js";

export class DcfToolsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getDcfFilingInputs(tickerRaw: string): Promise<DcfFilingInputsResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new DcfToolsError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }

  try {
    const fundamentals = await getFilingsFundamentals(ticker, {
      annualPeriodLimit: 6,
      quarterlyPeriodLimit: 8,
      annualFilingLimit: 8,
      quarterlyFilingLimit: 8,
      currentFilingLimit: 10,
    });
    return mapFilingsToDcfInputs(fundamentals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      throw new DcfToolsError(404, "not_found", `No SEC filing data found for ${ticker}.`);
    }
    throw err;
  }
}

export function runDcfCalculate(body: unknown): DcfCalculateResult {
  if (!body || typeof body !== "object") {
    throw new DcfToolsError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return calculateDCF(body as DcfCalculateInputs);
}

export { calculateDCF } from "./calculate.js";
export { mapFilingsToDcfInputs } from "./filingInputs.js";
