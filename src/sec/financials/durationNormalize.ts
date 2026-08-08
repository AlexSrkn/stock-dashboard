import type { XbrlFactObservation } from "./types.js";
import {
  classifyDuration,
  durationDays,
  is10QForm,
  normalizeFiscalPeriod,
  observationEnd,
  type DurationBucket,
  type NormalizedFiscalPeriod,
} from "./periodUtils.js";

export interface DurationNormalizedValue {
  reportedValue: number;
  normalizedQuarterValue: number;
  durationDays: number | null;
  durationBucket: DurationBucket;
  obs: XbrlFactObservation;
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

function findPriorQ1QuarterValue(
  beforeEnd: string,
  observations: XbrlFactObservation[]
): number | null {
  let best: XbrlFactObservation | null = null;
  for (const obs of observations) {
    if (!is10QForm(obs.form)) continue;
    if (normalizeFiscalPeriod(obs, "quarterly") !== "Q1") continue;
    if (classifyDuration(durationDays(obs)) !== "quarter") continue;
    const end = observationEnd(obs);
    if (!end || end >= beforeEnd) continue;
    if (!best || end.localeCompare(observationEnd(best)!) > 0) best = obs;
  }
  return best ? Number(best.val) : null;
}

function resolveFp(observations: XbrlFactObservation[]): NormalizedFiscalPeriod | null {
  for (const obs of observations) {
    const fp = normalizeFiscalPeriod(obs, "quarterly");
    if (fp && fp !== "FY" && fp !== "Q4") return fp;
  }
  return null;
}

/**
 * Normalize 10-Q duration metrics per period end (not SEC fy tag).
 * Q2 = H1(180d) − prior Q1 quarter, Q3 = 9M(270d) − H1 at same period end.
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
      const val = Number(quarter.val);
      out.set(key, {
        reportedValue: val,
        normalizedQuarterValue: val,
        durationDays: durationDays(quarter),
        durationBucket: "quarter",
        obs: quarter,
      });
      continue;
    }

    if (fp === "Q2") {
      if (quarter) {
        const val = Number(quarter.val);
        out.set(key, {
          reportedValue: val,
          normalizedQuarterValue: val,
          durationDays: durationDays(quarter),
          durationBucket: "quarter",
          obs: quarter,
        });
      } else if (h1) {
        const reported = Number(h1.val);
        const q1Val = findPriorQ1QuarterValue(end, eligible);
        out.set(key, {
          reportedValue: reported,
          normalizedQuarterValue: q1Val != null ? reported - q1Val : reported,
          durationDays: durationDays(h1),
          durationBucket: "h1_ytd",
          obs: h1,
        });
      }
      continue;
    }

    if (fp === "Q3") {
      if (quarter) {
        const val = Number(quarter.val);
        out.set(key, {
          reportedValue: val,
          normalizedQuarterValue: val,
          durationDays: durationDays(quarter),
          durationBucket: "quarter",
          obs: quarter,
        });
      } else if (nineM) {
        const reported = Number(nineM.val);
        const h1AtEnd = h1 ? Number(h1.val) : null;
        out.set(key, {
          reportedValue: reported,
          normalizedQuarterValue: h1AtEnd != null ? reported - h1AtEnd : reported,
          durationDays: durationDays(nineM),
          durationBucket: "nine_m_ytd",
          obs: nineM,
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

export function pickAnnualDurationValue(
  observations: XbrlFactObservation[]
): DurationNormalizedValue | null {
  const annual =
    pickBestByBucket(observations, "annual_ytd") ??
    observations.sort((a, b) => String(b.filed ?? "").localeCompare(String(a.filed ?? "")))[0];
  const obs = annual;
  if (!obs) return null;
  const val = Number(obs.val);
  return {
    reportedValue: val,
    normalizedQuarterValue: val,
    durationDays: durationDays(obs),
    durationBucket: classifyDuration(durationDays(obs)),
    obs,
  };
}
