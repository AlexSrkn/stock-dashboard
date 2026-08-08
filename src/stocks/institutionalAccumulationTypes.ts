export interface InstitutionalAccumulationRow {
  ticker: string;
  sharesBought: number;
  currentShares: number;
  previousShares: number;
  institutionCount: number;
}

export interface InstitutionalAccumulationPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  count: number;
  stocks: InstitutionalAccumulationRow[];
}
