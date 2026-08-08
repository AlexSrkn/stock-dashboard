import { getCachedSmartMoneyScore } from "../../smartMoney/cache.js";
import { getCachedDoubleSignal } from "../../signals/doubleSignal/cache.js";
import { getCachedTripleSignal } from "../../signals/tripleSignal/cache.js";
import { getCachedHiddenGems } from "../../signals/hiddenGems/cache.js";
import { getCachedConflictSignals } from "../../signals/conflictSignals/cache.js";
import { getCachedInstitutionalDiscovery } from "../../signals/institutionalDiscovery/cache.js";
import { getCachedConvictionScore } from "../../signals/convictionScore/cache.js";
import type { ComparePeriod } from "./types.js";
import { doubleTripleWindowDays } from "./period.js";
import type { CompareSignalValue, CompareSignals } from "./types.js";

function scoreSignal(
  score: number | null | undefined,
  href: string,
  label?: string | null
): CompareSignalValue {
  if (score == null || !Number.isFinite(Number(score))) {
    return { kind: "missing", href };
  }
  return { kind: "score", score: Number(score), label: label ?? null, href };
}

function activeSignal(active: boolean, href: string): CompareSignalValue {
  return { kind: "active", active, href };
}

export function buildSignalsSide(ticker: string, period: ComparePeriod): CompareSignals {
  const sym = String(ticker).trim().toUpperCase();
  const windowDays = doubleTripleWindowDays(period);

  const smart = getCachedSmartMoneyScore(sym);
  const double = getCachedDoubleSignal(windowDays)?.signals?.find(
    (s) => String(s.ticker).toUpperCase() === sym
  );
  const triple = getCachedTripleSignal(windowDays)?.signals?.find(
    (s) => String(s.ticker).toUpperCase() === sym
  );
  const gem = getCachedHiddenGems()?.signals?.find((s) => String(s.ticker).toUpperCase() === sym);
  const conflict = getCachedConflictSignals()?.signals?.find(
    (s) => String(s.ticker).toUpperCase() === sym
  );
  const discovery = getCachedInstitutionalDiscovery()?.signals?.find(
    (s) =>
      String(s.ticker).toUpperCase() === sym &&
      !s.insufficientData &&
      s.discoveryScore != null
  );
  // Prefer latest-quarter conviction rows
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
      (s) => String(s.ticker).toUpperCase() === sym && !s.insufficientData && s.convictionScore != null
    );

  return {
    smartMoney: smart
      ? scoreSignal(smart.smartMoneyConvictionScore, "/signals/smart-money")
      : { kind: "missing", href: "/signals/smart-money" },
    doubleSignal: activeSignal(Boolean(double), "/signals/double-signal"),
    tripleSignal: activeSignal(Boolean(triple), "/signals/triple-signal"),
    hiddenGem: gem
      ? scoreSignal(gem.hiddenGemScore, "/signals/hidden-gems", gem.label)
      : { kind: "missing", href: "/signals/hidden-gems" },
    conflictSignal: conflict
      ? scoreSignal(conflict.conflictScore, "/signals/conflict-signals")
      : { kind: "missing", href: "/signals/conflict-signals" },
    institutionalDiscovery: discovery
      ? scoreSignal(
          discovery.discoveryScore,
          "/signals/institutional-discovery",
          discovery.classification
        )
      : { kind: "missing", href: "/signals/institutional-discovery" },
    convictionScore: conviction
      ? scoreSignal(
          conviction.convictionScore,
          "/signals/conviction-score",
          conviction.classification
        )
      : { kind: "missing", href: "/signals/conviction-score" },
  };
}

export function activeSignalLabels(signals: CompareSignals): string[] {
  const out: string[] = [];
  const pushScore = (name: string, v: CompareSignalValue | null) => {
    if (v?.kind === "score") out.push(`${name}: ${Math.round(v.score)}`);
    if (v?.kind === "active" && v.active) out.push(name);
  };
  pushScore("Smart Money", signals.smartMoney);
  pushScore("Double Signal", signals.doubleSignal);
  pushScore("Triple Signal", signals.tripleSignal);
  pushScore("Hidden Gem", signals.hiddenGem);
  pushScore("Conflict Signal", signals.conflictSignal);
  pushScore("Institutional Discovery", signals.institutionalDiscovery);
  pushScore("Conviction Score", signals.convictionScore);
  return out;
}

export function highlightScore(
  signals: CompareSignals
): { name: string; score: number } | null {
  const candidates: { name: string; score: number }[] = [];
  const add = (name: string, v: CompareSignalValue | null) => {
    if (v?.kind === "score") candidates.push({ name, score: v.score });
  };
  add("Conviction Score", signals.convictionScore);
  add("Institutional Discovery", signals.institutionalDiscovery);
  add("Hidden Gem", signals.hiddenGem);
  add("Smart Money", signals.smartMoney);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!;
}
