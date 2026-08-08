/** Per-ticker raw signal totals before universe normalization. */
export interface TickerRawSignals {
  ticker: string;
  institutionalFlowRaw: number;
  insiderFlowRaw: number;
  politicianFlowRaw: number;
}

/** Normalized signal components in roughly [-1, 1] after z-score clipping. */
export interface TickerNormalizedSignals {
  ticker: string;
  institutionalScore: number;
  insiderScore: number;
  politicianScore: number;
}

export interface SmartMoneyScore {
  ticker: string;
  institutionalScore: number;
  insiderScore: number;
  politicianScore: number;
  alignmentScore: number;
  smartMoneyConvictionScore: number;
}

export interface SmartMoneyScoresPayload {
  computedAt: string;
  count: number;
  scores: SmartMoneyScore[];
}
