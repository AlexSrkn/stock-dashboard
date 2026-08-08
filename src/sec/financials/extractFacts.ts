import { collectInstantMetricsByPeriod } from "./balanceSheetExtract.js";
import { enrichPeriodRows } from "./derivedMetrics.js";
import {
  normalizeQuarterlyDurations,
  pickAnnualDurationValue,
} from "./durationNormalize.js";
import { FINANCIAL_METRIC_DEFINITIONS, METRICS_BY_STATEMENT } from "./metrics.js";
import {
  comparePeriodRows,
  finalizePeriodRows,
  INSTANT_PRIMARY_METRICS,
  periodCanonicalKey,
} from "./periodRows.js";
import {
  is10KForm,
  is10QForm,
  isValidFilingDate,
  normalizeFiscalPeriod,
  observationEnd,
  parseIsoDate,
  type NormalizedFiscalPeriod,
} from "./periodUtils.js";
import { validateQuarterlyRevenue } from "./validateMetrics.js";
import type {
  ExtractedMetricValue,
  FinancialMetricKey,
  FinancialPeriodRow,
  MetricSourceRef,
  MetricValueDetail,
  SecCompanyFacts,
  StatementBundle,
  XbrlFactConcept,
  XbrlFactObservation,
} from "./types.js";
import type { StatementSection } from "./types.js";

const NAMESPACES = ["us-gaap", "ifrs-full", "dei"] as const;

interface RowDraft {
  end: string;
  filed: string | null;
  form: string | null;
  fp: NormalizedFiscalPeriod;
  fy: number;
  accessionNumber: string | null;
  metrics: Partial<Record<FinancialMetricKey, number>>;
  metricDetails: Partial<Record<FinancialMetricKey, MetricValueDetail>>;
  metricSources: Partial<Record<FinancialMetricKey, MetricSourceRef>>;
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

function isValidDurationObservation(obs: XbrlFactObservation): boolean {
  const val = Number(obs.val);
  if (!Number.isFinite(val)) return false;
  const end = observationEnd(obs);
  const filed = parseIsoDate(obs.filed);
  if (!end || !filed) return false;
  return isValidFilingDate(end, filed);
}

function toMetricSource(
  obs: XbrlFactObservation,
  gaapTag: string,
  namespace: string
): MetricSourceRef {
  return {
    gaapTag,
    namespace,
    accn: obs.accn ? String(obs.accn) : null,
    filed: parseIsoDate(obs.filed),
    form: obs.form ? String(obs.form) : null,
  };
}

function isLikelyFinancialPeriodEnd(obs: XbrlFactObservation): boolean {
  const end = observationEnd(obs);
  const filed = parseIsoDate(obs.filed);
  if (!end || !filed) return false;
  // Exclude facts whose end equals filing date (metadata artifacts, not period ends).
  return end !== filed;
}

function ensureRow(
  rows: Map<string, RowDraft>,
  scope: "annual" | "quarterly",
  fy: number,
  fp: NormalizedFiscalPeriod,
  end: string,
  obs: XbrlFactObservation
): RowDraft {
  const key = periodCanonicalKey(fy, fp, end);
  let row = rows.get(key);
  if (!row) {
    row = {
      end,
      filed: parseIsoDate(obs.filed),
      form: obs.form ? String(obs.form) : null,
      fp,
      fy,
      accessionNumber: obs.accn ? String(obs.accn) : null,
      metrics: {},
      metricDetails: {},
      metricSources: {},
    };
    rows.set(key, row);
  } else if (obs.fy != null && Number.isFinite(Number(obs.fy))) {
    row.fy = Number(obs.fy);
  }
  return row;
}

function applyMetric(
  row: RowDraft,
  key: FinancialMetricKey,
  normalized: number,
  reported: number,
  durationDays: number | null,
  obs: XbrlFactObservation,
  gaapTag: string,
  namespace: string
): void {
  row.metrics[key] = normalized;
  row.metricDetails[key] = {
    reportedValue: reported,
    normalizedQuarterValue: normalized,
    durationDays,
  };
  row.metricSources[key] = toMetricSource(obs, gaapTag, namespace);
}

function durationObsKey(obs: XbrlFactObservation): string {
  return `${obs.accn ?? ""}|${observationEnd(obs) ?? ""}|${obs.start ?? ""}|${obs.val}|${obs.fp ?? ""}`;
}

function collectDurationObservations(
  facts: SecCompanyFacts,
  scope: "annual" | "quarterly"
): Map<FinancialMetricKey, XbrlFactObservation[]> {
  const byMetric = new Map<FinancialMetricKey, XbrlFactObservation[]>();
  const formOk = scope === "annual" ? is10KForm : is10QForm;

  for (const def of FINANCIAL_METRIC_DEFINITIONS) {
    if (def.valueType !== "duration") continue;
    const seen = new Set<string>();
    const allObs: XbrlFactObservation[] = [];

    for (const tag of def.tags) {
      const found = findConcept(facts.facts, tag);
      if (!found) continue;
      for (const obs of pickUnitObservations(found.concept, def.unit)) {
        if (!isValidDurationObservation(obs)) continue;
        if (!formOk(obs.form)) continue;
        if (normalizeFiscalPeriod(obs, scope) == null) continue;
        const key = durationObsKey(obs);
        if (seen.has(key)) continue;
        seen.add(key);
        allObs.push(obs);
      }
    }

    if (allObs.length) byMetric.set(def.key, allObs);
  }

  return byMetric;
}

function collectDurationRows(
  facts: SecCompanyFacts,
  scope: "annual" | "quarterly"
): Map<string, RowDraft> {
  const rows = new Map<string, RowDraft>();
  const byMetric = collectDurationObservations(facts, scope);

  if (scope === "quarterly") {
    for (const [metricKey, observations] of byMetric) {
      const def = FINANCIAL_METRIC_DEFINITIONS.find((d) => d.key === metricKey);
      if (!def) continue;
      const tag = def.tags.find((t) => findConcept(facts.facts, t)) ?? def.tags[0];
      const ns = findConcept(facts.facts, tag)?.namespace ?? "us-gaap";
      const normalized = normalizeQuarterlyDurations(observations);

      for (const [periodId, pick] of normalized) {
        const [fp, end] = periodId.split("|") as [NormalizedFiscalPeriod, string];
        const fy = pick.obs.fy != null ? Number(pick.obs.fy) : NaN;
        if (!Number.isFinite(fy)) continue;
        const row = ensureRow(rows, scope, fy, fp, end, pick.obs);
        applyMetric(
          row,
          metricKey,
          pick.normalizedQuarterValue,
          pick.reportedValue,
          pick.durationDays,
          pick.obs,
          tag,
          ns
        );
      }
    }
  } else {
    for (const [metricKey, observations] of byMetric) {
      const byEnd = new Map<string, XbrlFactObservation[]>();
      for (const obs of observations) {
        const end = observationEnd(obs);
        if (!end) continue;
        const list = byEnd.get(end) ?? [];
        list.push(obs);
        byEnd.set(end, list);
      }

      for (const [end, obsList] of byEnd) {
        const def = FINANCIAL_METRIC_DEFINITIONS.find((d) => d.key === metricKey);
        if (!def) continue;
        const tag = def.tags.find((t) => findConcept(facts.facts, t)) ?? def.tags[0];
        const ns = findConcept(facts.facts, tag)?.namespace ?? "us-gaap";
        const pick = pickAnnualDurationValue(obsList);
        if (!pick) continue;
        const fp = normalizeFiscalPeriod(pick.obs, "annual");
        const fy = pick.obs.fy != null ? Number(pick.obs.fy) : NaN;
        if (!fp || !Number.isFinite(fy)) continue;
        const row = ensureRow(rows, scope, fy, fp, end, pick.obs);
        applyMetric(
          row,
          metricKey,
          pick.normalizedQuarterValue,
          pick.reportedValue,
          pick.durationDays,
          pick.obs,
          tag,
          ns
        );
      }
    }
  }

  return rows;
}

function collectInstantRows(
  facts: SecCompanyFacts,
  scope: "annual" | "quarterly",
  anchorByFpEnd: Map<string, string>,
  periodAccessions: Map<string, string> = new Map()
): Map<string, RowDraft> {
  const rows = new Map<string, RowDraft>();

  for (const def of FINANCIAL_METRIC_DEFINITIONS) {
    if (def.valueType !== "instant") continue;
    const picks = collectInstantMetricsByPeriod(facts, def, scope, periodAccessions);
    for (const [periodKey, pick] of picks) {
      const [fyStr, fp, end] = periodKey.split("|");
      const fy = Number(fyStr);
      if (!Number.isFinite(fy)) continue;

      const fpEnd = `${fp}|${end}`;
      const anchorKey = anchorByFpEnd.get(fpEnd);
      const canAnchor =
        Boolean(anchorKey) ||
        (INSTANT_PRIMARY_METRICS.has(def.key) && isLikelyFinancialPeriodEnd(pick.obs));
      if (!canAnchor) continue;

      const targetKey = anchorKey ?? periodKey;
      const [targetFy, targetFp, targetEnd] = targetKey.split("|");
      const row = ensureRow(
        rows,
        scope,
        Number(targetFy),
        targetFp as NormalizedFiscalPeriod,
        targetEnd,
        pick.obs
      );
      applyMetric(row, def.key, pick.value, pick.value, null, pick.obs, pick.gaapTag, pick.namespace);
    }
  }

  return rows;
}

function mergeRowMaps(
  durationRows: Map<string, RowDraft>,
  instantRows: Map<string, RowDraft>
): Map<string, RowDraft> {
  const merged = new Map(durationRows);
  for (const [key, instantRow] of instantRows) {
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, instantRow);
      continue;
    }
    Object.assign(existing.metrics, instantRow.metrics);
    Object.assign(existing.metricDetails, instantRow.metricDetails);
    Object.assign(existing.metricSources, instantRow.metricSources);
  }
  return merged;
}

function rowsFromDrafts(drafts: Map<string, RowDraft>): FinancialPeriodRow[] {
  return [...drafts.values()].map((r) => ({
    end: r.end,
    filed: r.filed,
    form: r.form,
    fp: r.fp,
    fy: r.fy,
    accessionNumber: r.accessionNumber,
    metrics: r.metrics,
    metricDetails: r.metricDetails,
    metricSources: r.metricSources,
    derived: {},
  }));
}

function buildPeriodRows(
  facts: SecCompanyFacts,
  scope: "annual" | "quarterly",
  limit: number
): FinancialPeriodRow[] {
  const durationRows = collectDurationRows(facts, scope);
  const anchorByFpEnd = new Map<string, string>();
  const periodAccessions = new Map<string, string>();
  for (const [key, row] of durationRows) {
    const parts = key.split("|");
    const fpEnd = `${parts[1]}|${parts[2]}`;
    if (!anchorByFpEnd.has(fpEnd)) anchorByFpEnd.set(fpEnd, key);
    if (row.accessionNumber) periodAccessions.set(key, row.accessionNumber);
  }
  const instantRows = collectInstantRows(facts, scope, anchorByFpEnd, periodAccessions);
  const merged = mergeRowMaps(durationRows, instantRows);
  const rows = finalizePeriodRows(enrichPeriodRows(rowsFromDrafts(merged), scope), scope);
  return rows.slice(0, limit);
}

function buildLatestFromRows(rows: FinancialPeriodRow[]): Partial<Record<FinancialMetricKey, ExtractedMetricValue>> {
  const latest: Partial<Record<FinancialMetricKey, ExtractedMetricValue>> = {};
  const row = rows[0];
  if (!row) return latest;
  for (const def of FINANCIAL_METRIC_DEFINITIONS) {
    const value = row.metrics[def.key];
    const source = row.metricSources[def.key];
    if (value == null || !source) continue;
    latest[def.key] = {
      key: def.key,
      label: def.label,
      value,
      unit: def.unit,
      end: row.end,
      filed: source.filed,
      form: source.form,
      accn: source.accn,
      fp: row.fp,
      fy: row.fy,
      gaapTag: source.gaapTag,
      namespace: source.namespace,
    };
  }
  return latest;
}

function pickLatestRowForStatement(
  annual: FinancialPeriodRow[],
  quarterly: FinancialPeriodRow[],
  statement: StatementSection
): FinancialPeriodRow | null {
  const keys = new Set(METRICS_BY_STATEMENT[statement].map((d) => d.key));
  const hasStatement = (row: FinancialPeriodRow) =>
    Object.keys(row.metrics).some((k) => keys.has(k as FinancialMetricKey));
  const quarterlyMatches = quarterly.filter(hasStatement);
  if (quarterlyMatches.length) {
    return [...quarterlyMatches].sort(comparePeriodRows)[0] ?? null;
  }
  const annualMatches = annual.filter(hasStatement);
  if (annualMatches.length) {
    return [...annualMatches].sort(comparePeriodRows)[0] ?? null;
  }
  return quarterly[0] ?? annual[0] ?? null;
}

function buildStatementBundle(
  annual: FinancialPeriodRow[],
  quarterly: FinancialPeriodRow[],
  statement: StatementSection
): StatementBundle {
  const keys = new Set(
    FINANCIAL_METRIC_DEFINITIONS.filter((d) => d.statement === statement).map((d) => d.key)
  );
  const filterRow = (row: FinancialPeriodRow): FinancialPeriodRow => ({
    ...row,
    metrics: Object.fromEntries(
      Object.entries(row.metrics).filter(([k]) => keys.has(k as FinancialMetricKey))
    ) as FinancialPeriodRow["metrics"],
    metricDetails: Object.fromEntries(
      Object.entries(row.metricDetails).filter(([k]) => keys.has(k as FinancialMetricKey))
    ) as FinancialPeriodRow["metricDetails"],
    metricSources: Object.fromEntries(
      Object.entries(row.metricSources).filter(([k]) => keys.has(k as FinancialMetricKey))
    ) as FinancialPeriodRow["metricSources"],
  });
  const annualFiltered = annual.map(filterRow);
  const quarterlyFiltered = quarterly.map(filterRow);
  const latestSource = pickLatestRowForStatement(annualFiltered, quarterlyFiltered, statement);
  const latest: Partial<Record<FinancialMetricKey, ExtractedMetricValue>> = {};
  if (latestSource) {
    for (const def of FINANCIAL_METRIC_DEFINITIONS) {
      if (def.statement !== statement) continue;
      const value = latestSource.metrics[def.key];
      const source = latestSource.metricSources[def.key];
      if (value == null || !source) continue;
      latest[def.key] = {
        key: def.key,
        label: def.label,
        value,
        unit: def.unit,
        end: latestSource.end,
        filed: source.filed,
        form: source.form,
        accn: source.accn,
        fp: latestSource.fp,
        fy: latestSource.fy,
        gaapTag: source.gaapTag,
        namespace: source.namespace,
      };
    }
  }
  return { latest, annual: annualFiltered, quarterly: quarterlyFiltered };
}

export function extractFinancialPeriods(
  facts: SecCompanyFacts,
  options: { annualLimit?: number; quarterlyLimit?: number } = {}
): { annual: FinancialPeriodRow[]; quarterly: FinancialPeriodRow[] } {
  const annualLimit = Math.min(20, Math.max(1, options.annualLimit ?? 5));
  const quarterlyLimit = Math.min(24, Math.max(1, options.quarterlyLimit ?? 8));
  const annual = buildPeriodRows(facts, "annual", annualLimit);
  const quarterly = validateQuarterlyRevenue(
    buildPeriodRows(facts, "quarterly", quarterlyLimit),
    annual
  );
  return { annual, quarterly };
}

export function extractLatestMetrics(
  facts: SecCompanyFacts
): Partial<Record<FinancialMetricKey, ExtractedMetricValue>> {
  const { quarterly, annual } = extractFinancialPeriods(facts, {
    annualLimit: 1,
    quarterlyLimit: 12,
  });
  const latestRow =
    pickLatestRowForStatement(annual, quarterly, "income") ??
    pickLatestRowForStatement(annual, quarterly, "balance") ??
    quarterly[0] ??
    annual[0];
  return latestRow ? buildLatestFromRows([latestRow]) : {};
}

export function extractFinancialsFromCompanyFacts(facts: SecCompanyFacts): {
  latest: Partial<Record<FinancialMetricKey, ExtractedMetricValue>>;
  annual: FinancialPeriodRow[];
  quarterly: FinancialPeriodRow[];
  statements: {
    incomeStatement: StatementBundle;
    balanceSheet: StatementBundle;
    cashFlow: StatementBundle;
  };
} {
  const { annual, quarterly } = extractFinancialPeriods(facts);
  const latestRow =
    pickLatestRowForStatement(annual, quarterly, "income") ??
    pickLatestRowForStatement(annual, quarterly, "balance") ??
    quarterly[0] ??
    annual[0];
  const latest = latestRow ? buildLatestFromRows([latestRow]) : {};
  return {
    latest,
    annual,
    quarterly,
    statements: {
      incomeStatement: buildStatementBundle(annual, quarterly, "income"),
      balanceSheet: buildStatementBundle(annual, quarterly, "balance"),
      cashFlow: buildStatementBundle(annual, quarterly, "cashflow"),
    },
  };
}

/** Exported for 8-K earnings parsing and tests. */
export function collectObservationsForAccession(
  facts: SecCompanyFacts,
  accessionNumber: string,
  formPrefix: string
): Map<
  FinancialMetricKey,
  { value: number; obs: XbrlFactObservation; gaapTag: string; namespace: string }
> {
  const out = new Map<
    FinancialMetricKey,
    { value: number; obs: XbrlFactObservation; gaapTag: string; namespace: string }
  >();
  const accn = String(accessionNumber).trim();
  if (!accn) return out;

  for (const def of FINANCIAL_METRIC_DEFINITIONS) {
    for (const tag of def.tags) {
      const found = findConcept(facts.facts, tag);
      if (!found) continue;
      const observations = pickUnitObservations(found.concept, def.unit).filter((obs) => {
        if (String(obs.accn ?? "") !== accn) return false;
        if (!String(obs.form ?? "").toUpperCase().startsWith(formPrefix.toUpperCase())) return false;
        if (def.valueType === "instant") {
          return Boolean(observationEnd(obs)) && parseIsoDate(obs.filed);
        }
        return isValidDurationObservation(obs);
      });
      const best = observations.sort((a, b) =>
        String(b.filed ?? "").localeCompare(String(a.filed ?? ""))
      )[0];
      if (!best || out.has(def.key)) continue;
      out.set(def.key, {
        value: Number(best.val),
        obs: best,
        gaapTag: tag,
        namespace: found.namespace,
      });
    }
  }
  return out;
}
