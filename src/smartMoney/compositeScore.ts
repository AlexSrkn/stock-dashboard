import { convictionScoreFromFinal, signNonZero, zScoreNormalizeMap } from "./normalize.js";
import type { SmartMoneyScore, TickerRawSignals } from "./types.js";

const INSTITUTIONAL_WEIGHT = 0.5;
const INSIDER_WEIGHT = 0.35;
const POLITICIAN_WEIGHT = 0.15;
const POLITICIAN_NOISE_DAMPING = 0.5;

/**
 * Directional agreement in [0, 1].
 * 1 = all three signals same sign; 0 = fully mixed / neutral.
 */
export function computeAlignmentScore(
  institutional: number,
  insider: number,
  politician: number
): number {
  const sum =
    signNonZero(institutional) + signNonZero(insider) + signNonZero(politician);
  return Math.abs(sum) / 3;
}

export function computeWeightedRawScore(
  institutional: number,
  insider: number,
  politician: number,
  alignment: number
): number {
  const blended =
    INSTITUTIONAL_WEIGHT * institutional +
    INSIDER_WEIGHT * insider +
    POLITICIAN_WEIGHT * politician;
  return blended * (0.5 + 0.5 * alignment);
}

export function buildSmartMoneyScores(rawRows: TickerRawSignals[]): SmartMoneyScore[] {
  if (!rawRows.length) return [];

  const instMap = new Map(rawRows.map((r) => [r.ticker, r.institutionalFlowRaw]));
  const insiderMap = new Map(rawRows.map((r) => [r.ticker, r.insiderFlowRaw]));
  const polMap = new Map(
    rawRows.map((r) => [r.ticker, r.politicianFlowRaw * POLITICIAN_NOISE_DAMPING])
  );

  const instNorm = zScoreNormalizeMap(instMap);
  const insiderNorm = zScoreNormalizeMap(insiderMap);
  const polNorm = zScoreNormalizeMap(polMap);

  const tickers = [...new Set(rawRows.map((r) => r.ticker))].sort();
  const finals: number[] = [];
  const draft: Array<{
    ticker: string;
    institutionalScore: number;
    insiderScore: number;
    politicianScore: number;
    alignmentScore: number;
    finalScore: number;
  }> = [];

  for (const ticker of tickers) {
    const institutionalScore = instNorm.get(ticker) ?? 0;
    const insiderScore = insiderNorm.get(ticker) ?? 0;
    const politicianScore = polNorm.get(ticker) ?? 0;
    const alignmentScore = computeAlignmentScore(
      institutionalScore,
      insiderScore,
      politicianScore
    );
    const finalScore = computeWeightedRawScore(
      institutionalScore,
      insiderScore,
      politicianScore,
      alignmentScore
    );
    finals.push(finalScore);
    draft.push({
      ticker,
      institutionalScore,
      insiderScore,
      politicianScore,
      alignmentScore,
      finalScore,
    });
  }

  return draft
    .map((row) => ({
      ticker: row.ticker,
      institutionalScore: round4(row.institutionalScore),
      insiderScore: round4(row.insiderScore),
      politicianScore: round4(row.politicianScore),
      alignmentScore: round4(row.alignmentScore),
      smartMoneyConvictionScore: convictionScoreFromFinal(row.finalScore, finals),
    }))
    .sort((a, b) => b.smartMoneyConvictionScore - a.smartMoneyConvictionScore);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
