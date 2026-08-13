import { getCachedSmartMoneyScore } from "../smartMoney/cache.js";
import { getCachedDoubleSignal } from "../signals/doubleSignal/cache.js";
import { DEFAULT_DOUBLE_SIGNAL_WINDOW } from "../signals/doubleSignal/types.js";
import { getCachedTripleSignal } from "../signals/tripleSignal/cache.js";
import { DEFAULT_TRIPLE_SIGNAL_WINDOW } from "../signals/tripleSignal/types.js";
import { getCachedHiddenGems } from "../signals/hiddenGems/cache.js";
import { getCachedConflictSignals } from "../signals/conflictSignals/cache.js";
import { getCachedInstitutionalDiscovery } from "../signals/institutionalDiscovery/cache.js";
import { getCachedConvictionScore } from "../signals/convictionScore/cache.js";
import { getCachedTopInstitutionNewEntries } from "../signals/topInstitutionNewEntriesCache.js";
import type {
  SignalDirection,
  SignalStrength,
  StockSignal,
} from "./stockSignals.js";

export type StockCachedSignal = StockSignal;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function directionFromScore(score: number): SignalDirection {
  if (score >= 55) return "buying";
  if (score <= 45) return "selling";
  return "neutral";
}

function strengthFromScore(score: number): SignalStrength {
  if (score >= 70 || score <= 30) return "high";
  if (score >= 55 || score <= 45) return "normal";
  return "neutral";
}

function smartMoneyQualifies(score: number): boolean {
  return score >= 65 || score <= 35;
}

function pushScoreSignal(
  out: StockCachedSignal[],
  input: {
    category: string;
    label: string;
    score: number;
    href: string;
    hint: string;
    buyStat: number;
    sellStat: number;
    netStat: number;
    statLabels: { buy: string; sell: string; net: string };
    statValuesAreNumeric?: boolean;
  }
): void {
  out.push({
    category: input.category as StockSignal["category"],
    label: input.label,
    direction: directionFromScore(input.score),
    strength: strengthFromScore(input.score),
    buyValueUsd: round2(input.buyStat),
    sellValueUsd: round2(input.sellStat),
    netValueUsd: round2(input.netStat),
    ratio: null,
    href: input.href,
    hint: input.hint,
    statLabels: input.statLabels,
    statValuesAreNumeric: input.statValuesAreNumeric ?? true,
  });
}

/** Cached hub signals that qualify for a ticker (empty when none match). */
export function buildStockCachedSignals(ticker: string): StockCachedSignal[] {
  const sym = String(ticker || "").trim().toUpperCase();
  if (!sym) return [];

  const out: StockCachedSignal[] = [];

  const smart = getCachedSmartMoneyScore(sym);
  if (smart && smartMoneyQualifies(smart.smartMoneyConvictionScore)) {
    pushScoreSignal(out, {
      category: "smart-money",
      label: smart.smartMoneyConvictionScore >= 65 ? "Bullish conviction" : "Bearish conviction",
      score: smart.smartMoneyConvictionScore,
      href: "/signals/smart-money",
      hint: "Composite institutional, insider & congressional flow alignment",
      buyStat: smart.institutionalScore,
      sellStat: smart.insiderScore,
      netStat: smart.politicianScore,
      statLabels: { buy: "Institutional", sell: "Insider", net: "Congress" },
    });
  }

  const double = getCachedDoubleSignal(DEFAULT_DOUBLE_SIGNAL_WINDOW)?.signals?.find(
    (s) => String(s.ticker).toUpperCase() === sym
  );
  if (double) {
    pushScoreSignal(out, {
      category: "double-signal",
      label: `Double signal · strength ${Math.round(double.signalStrengthScore)}`,
      score: double.signalStrengthScore,
      href: "/signals/double-signal",
      hint: "Institutional accumulation plus insider open-market buying",
      buyStat: double.totalInstitutionalValueUsd,
      sellStat: double.totalInsiderPurchaseUsd,
      netStat: double.totalInstitutionalValueUsd + double.totalInsiderPurchaseUsd,
      statLabels: { buy: "Institutional", sell: "Insider", net: "Combined" },
      statValuesAreNumeric: false,
    });
  }

  const triple = getCachedTripleSignal(DEFAULT_TRIPLE_SIGNAL_WINDOW)?.signals?.find(
    (s) => String(s.ticker).toUpperCase() === sym
  );
  if (triple) {
    pushScoreSignal(out, {
      category: "triple-signal",
      label: `Triple signal · strength ${Math.round(triple.signalStrengthScore)}`,
      score: triple.signalStrengthScore,
      href: "/signals/triple-signal",
      hint: "Institutional, insider, and congressional buying overlap",
      buyStat: triple.totalInstitutionalValueUsd,
      sellStat: triple.totalInsiderPurchaseUsd,
      netStat: triple.totalPoliticianPurchaseUsd,
      statLabels: { buy: "Institutional", sell: "Insider", net: "Congress" },
      statValuesAreNumeric: false,
    });
  }

  const topEntries = getCachedTopInstitutionNewEntries()?.entries?.filter(
    (e) => String(e.ticker).toUpperCase() === sym
  );
  if (topEntries?.length) {
    const totalValue = topEntries.reduce(
      (sum, e) => sum + (Number.isFinite(Number(e.currentValueUsd)) ? Number(e.currentValueUsd) : 0),
      0
    );
    const institutions = new Set(topEntries.map((e) => e.institutionId)).size;
    pushScoreSignal(out, {
      category: "top-institution-entry",
      label:
        institutions === 1
          ? "New entry from top institution"
          : `New entries from ${institutions} top institutions`,
      score: Math.min(100, institutions * 20 + (totalValue > 0 ? 40 : 20)),
      href: "/signals/top-institution-new-entries",
      hint: "New position opened by a top-performing tracked institution",
      buyStat: totalValue,
      sellStat: institutions,
      netStat: topEntries.length,
      statLabels: { buy: "Position value", sell: "Institutions", net: "Entries" },
      statValuesAreNumeric: false,
    });
  }

  const gem = getCachedHiddenGems()?.signals?.find((s) => String(s.ticker).toUpperCase() === sym);
  if (gem) {
    pushScoreSignal(out, {
      category: "hidden-gem",
      label: gem.label || "Hidden gem",
      score: gem.hiddenGemScore,
      href: "/signals/hidden-gems",
      hint: "Low institutional ownership with accelerating accumulation",
      buyStat: gem.hiddenGemScore,
      sellStat: gem.increasingPositionsCount,
      netStat: gem.newPositionsCount,
      statLabels: { buy: "Score", sell: "Increasing", net: "New positions" },
    });
  }

  const conflict = getCachedConflictSignals()?.signals?.find(
    (s) => String(s.ticker).toUpperCase() === sym
  );
  if (conflict) {
    const bullishConflict =
      conflict.signalType === "institutions_selling_insiders_buying" ||
      conflict.insiderScore > conflict.institutionScore;
    pushScoreSignal(out, {
      category: "conflict-signal",
      label: conflict.signalType.replace(/_/g, " "),
      score: conflict.conflictScore,
      href: "/signals/conflict-signals",
      hint: "Institutional and insider flows diverge materially",
      buyStat: conflict.insiderBuyVolumeUsd,
      sellStat: conflict.insiderSellVolumeUsd,
      netStat: conflict.institutionScore,
      statLabels: { buy: "Insider buys", sell: "Insider sells", net: "Inst score" },
      statValuesAreNumeric: false,
    });
    out[out.length - 1]!.direction = bullishConflict ? "buying" : "selling";
  }

  const discoveryCache = getCachedInstitutionalDiscovery();
  const discovery = discoveryCache?.signals?.find(
    (s) =>
      String(s.ticker).toUpperCase() === sym &&
      !s.insufficientData &&
      s.discoveryScore != null
  );
  if (discovery) {
    pushScoreSignal(out, {
      category: "institutional-discovery",
      label: discovery.classification || "Institutional discovery",
      score: discovery.discoveryScore!,
      href: "/signals/institutional-discovery",
      hint: "Growing institutional holder base and ownership",
      buyStat: discovery.discoveryScore!,
      sellStat: discovery.newHolderCount,
      netStat: discovery.currentHolderCount,
      statLabels: { buy: "Score", sell: "New holders", net: "Holders" },
    });
  }

  const convictionCache = getCachedConvictionScore();
  const conviction =
    convictionCache?.signals?.find(
      (s) =>
        String(s.ticker).toUpperCase() === sym &&
        s.quarter === convictionCache.currentQuarter &&
        !s.insufficientData &&
        s.convictionScore != null
    ) ??
    convictionCache?.signals?.find(
      (s) =>
        String(s.ticker).toUpperCase() === sym && !s.insufficientData && s.convictionScore != null
    );
  if (conviction?.convictionScore != null) {
    pushScoreSignal(out, {
      category: "conviction-score",
      label: conviction.classification || "Conviction score",
      score: conviction.convictionScore,
      href: "/signals/conviction-score",
      hint: "Portfolio-weight breadth and accumulation persistence",
      buyStat: conviction.convictionScore,
      sellStat: conviction.institutionalHolders,
      netStat: conviction.medianPortfolioWeight,
      statLabels: { buy: "Score", sell: "Holders", net: "Med weight %" },
    });
  }

  return out;
}
