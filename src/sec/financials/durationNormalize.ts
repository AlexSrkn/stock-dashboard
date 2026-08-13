import type { XbrlFactObservation } from "./types.js";
import {
  classifyDuration,
  durationDays,
  is10KForm,
  is10QForm,
  normalizeFiscalPeriod,
  observationEnd,
  type DurationBucket,
  type NormalizedFiscalPeriod,
} from "./periodUtils.js";

export interface DurationNormalizedValue {
  reportedValue: number;
  /**
   * Standalone quarter value when known (direct quarter fact, or YTD − prior YTD).
   * Null when only a multi-quarter YTD fact exists and derivation is not possible.
   */
  normalizedQuarterValue: number | null;
  durationDays: number | null;
  durationBucket: DurationBucket;
  /** True when normalizedQuarterValue was computed as current YTD − prior YTD. */
  derivedStandalone: boolean;
  obs: XbrlFactObservation;
  /** Prior YTD observation used for derivation (when derivedStandalone). */
  priorObs: XbrlFactObservation | null;
}

function pickBestByBucket(
  observations: XbrlFactObservation[],
  bucket: DurationBucket
): XbrlFactObservation | null {
  const matches = observations.filter((obs) => classifyDuration(durationDays(obs)) === bucket);
  if (!matches.length) return null;
  return matches.sort((a, b) => String(b.filed ?? "").localeCompare(String(a.filed ?? "")))[0] ?? null;
}

function pickQuarterDuration(observations: XbrlFactObservation[]): XbrlFactObservation | null {
  return pickBestByBucket(observations, "quarter");
}

function periodKey(fp: NormalizedFiscalPeriod, end: string): string {
  return `${fp}|${end}`;
}

function findPriorDurationObservation(
  beforeEnd: string,
  bucket: DurationBucket,
  observations: XbrlFactObservation[]
): XbrlFactObservation | null {
  let best: XbrlFactObservation | null = null;
  for (const obs of observations) {
    if (!is10QForm(obs.form)) continue;
    if (classifyDuration(durationDays(obs)) !== bucket) continue;
    const end = observationEnd(obs);
    if (!end || end >= beforeEnd) continue;
    if (!best || end.localeCompare(observationEnd(best)!) > 0) best = obs;
  }
  return best;
}

function findPriorQ1QuarterObservation(
  beforeEnd: string,
  observations: XbrlFactObservation[]
): XbrlFactObservation | null {
  let best: XbrlFactObservation | null = null;
  for (const obs of observations) {
    if (!is10QForm(obs.form)) continue;
    if (normalizeFiscalPeriod(obs, "quarterly") !== "Q1") continue;
    if (classifyDuration(durationDays(obs)) !== "quarter") continue;
    const end = observationEnd(obs);
    if (!end || end >= beforeEnd) continue;
    if (!best || end.localeCompare(observationEnd(best)!) > 0) best = obs;
  }
  return best;
}

function resolveFp(observations: XbrlFactObservation[]): NormalizedFiscalPeriod | null {
  for (const obs of observations) {
    const fp = normalizeFiscalPeriod(obs, "quarterly");
    if (fp && fp !== "FY" && fp !== "Q4") return fp;
  }
  return null;
}

function directQuarter(
  quarter: XbrlFactObservation
): DurationNormalizedValue {
  const val = Number(quarter.val);
  return {
    reportedValue: val,
    normalizedQuarterValue: val,
    durationDays: durationDays(quarter),
    durationBucket: "quarter",
    derivedStandalone: false,
    obs: quarter,
    priorObs: null,
  };
}

/**
 * Normalize 10-Q duration metrics per period end (not SEC fy tag).
 * Q2 = H1(180d) − prior Q1 quarter, Q3 = 9M(270d) − prior H1(180d) at earlier period end.
 * Never treat a multi-quarter YTD fact as a standalone quarter without derivation.
 */
export function normalizeQuarterlyDurations(
  observations: XbrlFactObservation[]
): Map<string, DurationNormalizedValue> {
  const byEnd = new Map<string, XbrlFactObservation[]>();
  const eligible: XbrlFactObservation[] = [];

  for (const obs of observations) {
    if (!is10QForm(obs.form)) continue;
    const fp = normalizeFiscalPeriod(obs, "quarterly");
    if (!fp || fp === "FY" || fp === "Q4") continue;
    const end = observationEnd(obs);
    if (!end) continue;
    eligible.push(obs);
    const list = byEnd.get(end) ?? [];
    list.push(obs);
    byEnd.set(end, list);
  }

  const out = new Map<string, DurationNormalizedValue>();
  const ends = [...byEnd.keys()].sort();

  for (const end of ends) {
    const obsList = byEnd.get(end) ?? [];
    const fp = resolveFp(obsList);
    if (!fp) continue;

    const quarter = pickQuarterDuration(obsList);
    const h1 = pickBestByBucket(obsList, "h1_ytd");
    const nineM = pickBestByBucket(obsList, "nine_m_ytd");
    const key = periodKey(fp, end);

    if (fp === "Q1" && quarter) {
      out.set(key, directQuarter(quarter));
      continue;
    }

    if (fp === "Q2") {
      if (quarter) {
        out.set(key, directQuarter(quarter));
      } else if (h1) {
        const reported = Number(h1.val);
        const priorQ1 = findPriorQ1QuarterObservation(end, eligible);
        const q1Val = priorQ1 != null ? Number(priorQ1.val) : null;
        const derived = q1Val != null;
        out.set(key, {
          reportedValue: reported,
          normalizedQuarterValue: derived ? reported - q1Val! : null,
          durationDays: durationDays(h1),
          durationBucket: "h1_ytd",
          derivedStandalone: derived,
          obs: h1,
          priorObs: derived ? priorQ1 : null,
        });
      }
      continue;
    }

    if (fp === "Q3") {
      if (quarter) {
        out.set(key, directQuarter(quarter));
      } else if (nineM) {
        const reported = Number(nineM.val);
        // Prior 6M YTD ends at Q2 period end — not at this Q3 end.
        const priorH1Obs = findPriorDurationObservation(end, "h1_ytd", eligible);
        const priorH1 = priorH1Obs != null ? Number(priorH1Obs.val) : null;
        const derived = priorH1 != null;
        out.set(key, {
          reportedValue: reported,
          normalizedQuarterValue: derived ? reported - priorH1! : null,
          durationDays: durationDays(nineM),
          durationBucket: "nine_m_ytd",
          derivedStandalone: derived,
          obs: nineM,
          priorObs: derived ? priorH1Obs : null,
        });
      }
    }
  }

  return out;
}

/** @deprecated Use normalizeQuarterlyDurations; kept for simple single-FY fixtures. */
export function normalizeQuarterlyDurationForFy(
  observations: XbrlFactObservation[]
): Map<NormalizedFiscalPeriod, DurationNormalizedValue> {
  const byPeriod = normalizeQuarterlyDurations(observations);
  const out = new Map<NormalizedFiscalPeriod, DurationNormalizedValue>();
  for (const [key, value] of byPeriod) {
    const fp = key.split("|")[0] as NormalizedFiscalPeriod;
    const existing = out.get(fp);
    if (!existing || String(observationEnd(value.obs)).localeCompare(String(observationEnd(existing.obs))) > 0) {
      out.set(fp, value);
    }
  }
  return out;
}

/**
 * Pick the annual (≈12-month) duration value for a period end.
 * Prefer the latest filing (restatements) for the numeric value.
 * Does not fall back to quarterly/YTD stubs that appear in 10-Ks as comparatives.
 */
export function pickAnnualDurationValue(
  observations: XbrlFactObservation[]
): DurationNormalizedValue | null {
  let obs = pickBestByBucket(observations, "annual_ytd");
  if (!obs) {
    // Some fixtures / older facts omit `start`; treat unknown-duration 10-K facts
    // as annual when they are not classified as quarter/YTD.
    const unknownAnnual = observations
      .filter((o) => is10KForm(o.form))
      .filter((o) => {
        const bucket = classifyDuration(durationDays(o));
        return bucket === "unknown" || bucket === "annual_ytd";
      })
      .sort((a, b) => String(b.filed ?? "").localeCompare(String(a.filed ?? "")));
    obs = unknownAnnual[0] ?? null;
  }
  if (!obs) return null;
  const val = Number(obs.val);
  const bucket = classifyDuration(durationDays(obs));
  return {
    reportedValue: val,
    normalizedQuarterValue: val,
    durationDays: durationDays(obs),
    durationBucket: bucket === "unknown" ? "annual_ytd" : bucket,
    derivedStandalone: false,
    obs,
    priorObs: null,
  };
}
