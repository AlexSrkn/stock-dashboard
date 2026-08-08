import type { FinancialMetricDefinition } from "./types.js";
import type { SecCompanyFacts, XbrlFactConcept, XbrlFactObservation } from "./types.js";
import {
  is10KForm,
  is10QForm,
  isInstantObservation,
  isValidFilingDate,
  normalizeFiscalPeriod,
  observationEnd,
  parseIsoDate,
  periodCanonicalKey,
  type NormalizedFiscalPeriod,
} from "./periodUtils.js";

const NAMESPACES = ["us-gaap", "ifrs-full", "dei"] as const;

export interface InstantMetricPick {
  value: number;
  obs: XbrlFactObservation;
  gaapTag: string;
  namespace: string;
}

function findConcept(
  facts: SecCompanyFacts["facts"],
  tag: string
): { namespace: string; concept: XbrlFactConcept } | null {
  if (!facts) return null;
  for (const namespace of NAMESPACES) {
    const concept = facts[namespace]?.[tag];
    if (concept) return { namespace, concept };
  }
  return null;
}

function pickUnitObservations(
  concept: XbrlFactConcept | undefined,
  preferredUnit: string
): XbrlFactObservation[] {
  if (!concept?.units) return [];
  const direct = concept.units[preferredUnit];
  if (direct?.length) return [...direct];
  const fallbackKey = Object.keys(concept.units).find(
    (k) => k.toLowerCase() === preferredUnit.toLowerCase()
  );
  if (fallbackKey) return [...(concept.units[fallbackKey] ?? [])];
  if (preferredUnit === "shares") {
    return concept.units.pure ? [...concept.units.pure] : [];
  }
  return [];
}

function obsFingerprint(obs: XbrlFactObservation): string {
  return `${obs.accn ?? ""}|${observationEnd(obs) ?? ""}|${obs.val}|${obs.form ?? ""}`;
}

function isValidInstant(obs: XbrlFactObservation): boolean {
  if (!isInstantObservation(obs)) return false;
  const val = Number(obs.val);
  if (!Number.isFinite(val)) return false;
  const end = observationEnd(obs);
  const filed = parseIsoDate(obs.filed);
  if (!end || !filed) return false;
  return isValidFilingDate(end, filed);
}

function isBetterInstantCandidate(
  candidate: XbrlFactObservation,
  current: XbrlFactObservation
): boolean {
  const candFiled = String(candidate.filed ?? "");
  const currFiled = String(current.filed ?? "");
  if (candFiled !== currFiled) return candFiled > currFiled;
  const candEnd = String(candidate.end ?? candidate.instant ?? "");
  const currEnd = String(current.end ?? current.instant ?? "");
  return candEnd >= currEnd;
}

function collectInstantCandidates(
  facts: SecCompanyFacts,
  def: FinancialMetricDefinition,
  scope: "annual" | "quarterly"
): Array<{ obs: XbrlFactObservation; gaapTag: string; namespace: string }> {
  const formOk = scope === "annual" ? is10KForm : is10QForm;
  const seen = new Set<string>();
  const out: Array<{ obs: XbrlFactObservation; gaapTag: string; namespace: string }> = [];

  for (const tag of def.tags) {
    const found = findConcept(facts.facts, tag);
    if (!found) continue;
    const pool = pickUnitObservations(found.concept, def.unit).filter(
      (obs) => isValidInstant(obs) && formOk(obs.form)
    );

    for (const obs of pool) {
      if (scope === "quarterly" && normalizeFiscalPeriod(obs, "quarterly") == null) continue;
      const key = obsFingerprint(obs);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ obs, gaapTag: tag, namespace: found.namespace });
    }
  }

  return out;
}

/**
 * Instant balance-sheet facts: fact.end must equal period end; most recent filing wins.
 */
export function collectInstantMetricsByPeriod(
  facts: SecCompanyFacts,
  def: FinancialMetricDefinition,
  scope: "annual" | "quarterly",
  periodAccessions: Map<string, string> = new Map()
): Map<string, InstantMetricPick> {
  const candidates = collectInstantCandidates(facts, def, scope);
  const byPeriod = new Map<string, Array<{ obs: XbrlFactObservation; gaapTag: string; namespace: string }>>();

  for (const candidate of candidates) {
    const end = observationEnd(candidate.obs);
    if (!end) continue;
    const fy = candidate.obs.fy != null ? Number(candidate.obs.fy) : NaN;
    if (!Number.isFinite(fy)) continue;

    const fp: NormalizedFiscalPeriod | null =
      scope === "annual" ? "FY" : normalizeFiscalPeriod(candidate.obs, "quarterly");
    if (!fp) continue;

    const periodKey = periodCanonicalKey(fy, fp, end);
    const list = byPeriod.get(periodKey) ?? [];
    list.push(candidate);
    byPeriod.set(periodKey, list);
  }

  const picks = new Map<string, InstantMetricPick>();
  for (const [periodKey, pool] of byPeriod) {
    const preferredAccn = periodAccessions.get(periodKey);
    const fpEnd = periodKey.split("|").slice(1).join("|");
    const anchorKey = [...periodAccessions.keys()].find((k) => k.endsWith(`|${fpEnd}`));
    const accnHint = preferredAccn ?? (anchorKey ? periodAccessions.get(anchorKey) : undefined);
    let filtered = accnHint
      ? pool.filter((c) => String(c.obs.accn ?? "") === accnHint)
      : pool;
    if (!filtered.length) filtered = pool;

    let best = filtered[0];
    for (const candidate of filtered.slice(1)) {
      if (isBetterInstantCandidate(candidate.obs, best.obs)) best = candidate;
    }
    if (!best) continue;
    picks.set(periodKey, {
      value: Number(best.obs.val),
      obs: best.obs,
      gaapTag: best.gaapTag,
      namespace: best.namespace,
    });
  }

  return picks;
}
