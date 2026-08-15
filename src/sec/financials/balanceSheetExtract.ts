import type { FinancialMetricDefinition } from "./types.js";
import type { SecCompanyFacts, XbrlFactConcept, XbrlFactObservation } from "./types.js";
import { resolveAnnualFiscalYear } from "./fiscalYear.js";
import {
  is10KForm,
  is10QForm,
  isInstantObservation,
  isValidFilingDate,
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

/** Duration (income/cash-flow) period identity for an exact period end. */
export interface DurationPeriodAnchor {
  fy: number;
  fp: NormalizedFiscalPeriod;
  key: string;
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
      // Quarterly scope: keep 10-Q instants (including comparatives); period
      // assignment uses exact instant date vs duration period ends below.
      if (scope === "quarterly" && !is10QForm(obs.form)) continue;
      const key = obsFingerprint(obs);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ obs, gaapTag: tag, namespace: found.namespace });
    }
  }

  return out;
}

/**
 * Instant balance-sheet facts bind by exact instant date only.
 *
 * Comparative figures in a later 10-Q often carry that filing's `fp`/`fy` while
 * the instant date is a prior period end (e.g. FYE assets tagged Q1). Those must
 * NOT create or attach to Q1/Q2/Q3 rows whose period end differs from the instant.
 *
 * Quarterly: only emit picks for instant dates that match a duration period end.
 * Annual: group by instant date; resolve fy from the original 10-K.
 */
export function collectInstantMetricsByPeriod(
  facts: SecCompanyFacts,
  def: FinancialMetricDefinition,
  scope: "annual" | "quarterly",
  periodAccessions: Map<string, string> = new Map(),
  durationPeriodByEnd: Map<string, DurationPeriodAnchor> = new Map()
): Map<string, InstantMetricPick> {
  const candidates = collectInstantCandidates(facts, def, scope);
  const byPeriod = new Map<
    string,
    Array<{ obs: XbrlFactObservation; gaapTag: string; namespace: string }>
  >();

  if (scope === "annual") {
    const byEnd = new Map<
      string,
      Array<{ obs: XbrlFactObservation; gaapTag: string; namespace: string }>
    >();
    for (const candidate of candidates) {
      const end = observationEnd(candidate.obs);
      if (!end) continue;
      const list = byEnd.get(end) ?? [];
      list.push(candidate);
      byEnd.set(end, list);
    }
    for (const [end, pool] of byEnd) {
      const fy = resolveAnnualFiscalYear(
        pool.map((c) => c.obs),
        end
      );
      if (fy == null) continue;
      byPeriod.set(periodCanonicalKey(fy, "FY", end), pool);
    }
  } else {
    for (const candidate of candidates) {
      const end = observationEnd(candidate.obs);
      if (!end) continue;
      // Exact instant date must equal a known quarterly period end.
      const anchor = durationPeriodByEnd.get(end);
      if (!anchor) continue;
      const list = byPeriod.get(anchor.key) ?? [];
      list.push(candidate);
      byPeriod.set(anchor.key, list);
    }
  }

  const picks = new Map<string, InstantMetricPick>();
  for (const [periodKey, pool] of byPeriod) {
    const preferredAccn = periodAccessions.get(periodKey);
    const parts = periodKey.split("|");
    const periodEnd = parts[2];
    let filtered = preferredAccn
      ? pool.filter((c) => String(c.obs.accn ?? "") === preferredAccn)
      : pool;
    if (!filtered.length) filtered = pool;

    // Instant date must still equal the period end (XBRL instant semantics).
    filtered = filtered.filter((c) => observationEnd(c.obs) === periodEnd);
    if (!filtered.length) continue;

    const tagRank = new Map(def.tags.map((tag, i) => [tag, i]));
    filtered = [...filtered].sort((a, b) => {
      const ra = tagRank.get(a.gaapTag) ?? 999;
      const rb = tagRank.get(b.gaapTag) ?? 999;
      if (ra !== rb) return ra - rb;
      if (isBetterInstantCandidate(a.obs, b.obs)) return -1;
      if (isBetterInstantCandidate(b.obs, a.obs)) return 1;
      return 0;
    });

    const best = filtered[0];
    if (!best) continue;
    picks.set(periodKey, {
      value: Number(best.obs.val),
      obs: best.obs,
      gaapTag: best.gaapTag,
      namespace: best.namespace,
    });
  }

  // Cover-page DEI shares use an "as of" date after fiscal period end (e.g. NVDA).
  // When period-end CommonStockSharesOutstanding is absent, attach DEI by accession.
  if (def.key === "shares_outstanding") {
    attachCoverPageSharesByAccession(picks, candidates, periodAccessions);
  }

  return picks;
}

/**
 * EntityCommonStockSharesOutstanding is often dated days/weeks after quarter end.
 * Bind it to the duration period from the same filing accession when that period
 * still lacks period-end shares.
 *
 * One 10-Q accession can span the current quarter and prior-year comparatives —
 * prefer the latest period end on/before the cover-page "as of" date.
 */
function attachCoverPageSharesByAccession(
  picks: Map<string, InstantMetricPick>,
  candidates: Array<{ obs: XbrlFactObservation; gaapTag: string; namespace: string }>,
  periodAccessions: Map<string, string>
): void {
  const accnToPeriods = new Map<string, string[]>();
  for (const [periodKey, accn] of periodAccessions) {
    if (!accn) continue;
    const list = accnToPeriods.get(accn) ?? [];
    list.push(periodKey);
    accnToPeriods.set(accn, list);
  }

  for (const candidate of candidates) {
    if (candidate.gaapTag !== "EntityCommonStockSharesOutstanding") continue;
    const accn = String(candidate.obs.accn ?? "");
    if (!accn) continue;
    const periodKeys = accnToPeriods.get(accn);
    if (!periodKeys?.length) continue;

    const coverEnd = observationEnd(candidate.obs);
    const ranked = periodKeys
      .map((key) => ({ key, end: key.split("|")[2] ?? "" }))
      .filter((p) => p.end.length > 0)
      .sort((a, b) => b.end.localeCompare(a.end));

    const chosen =
      (coverEnd
        ? ranked.find((p) => p.end <= coverEnd)?.key
        : null) ??
      ranked[0]?.key ??
      null;
    if (!chosen || picks.has(chosen)) continue;

    const value = Number(candidate.obs.val);
    if (!Number.isFinite(value) || !(value > 0)) continue;
    picks.set(chosen, {
      value,
      obs: candidate.obs,
      gaapTag: candidate.gaapTag,
      namespace: candidate.namespace,
    });
  }
}
