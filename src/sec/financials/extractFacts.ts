import { collectInstantMetricsByPeriod, type DurationPeriodAnchor } from "./balanceSheetExtract.js";
import { enrichPeriodRows } from "./derivedMetrics.js";
import {
  normalizeQuarterlyDurations,
  pickAnnualDurationValue,
} from "./durationNormalize.js";
import { resolveAnnualFiscalYear, resolveQuarterlyFiscalYear } from "./fiscalYear.js";
import { FINANCIAL_METRIC_DEFINITIONS, METRICS_BY_STATEMENT } from "./metrics.js";
import {
  comparePeriodRows,
  finalizePeriodRows,
  INSTANT_PRIMARY_METRICS,
  periodCanonicalKey,
} from "./periodRows.js";
import {
  classifyDuration,
  durationBucketLabel,
  durationDays,
  is10KForm,
  is10QForm,
  isValidFilingDate,
  isYtdDurationBucket,
  normalizeFiscalPeriod,
  observationEnd,
  parseIsoDate,
  type DurationBucket,
  type NormalizedFiscalPeriod,
} from "./periodUtils.js";
import { validateQuarterlyRevenue } from "./validateMetrics.js";
import type {
  CashFlowDerivationProvenance,
  CashFlowLatestMetrics,
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
    // Do not overwrite fy from later observations — row key already encodes the
    // resolved fiscal year (critical for annual restatements tagged with a later fy).
    if (row.fy == null) row.fy = Number(obs.fy);
  }
  return row;
}

function applyMetric(
  row: RowDraft,
  key: FinancialMetricKey,
  normalized: number | null,
  reported: number,
  metricDurationDays: number | null,
  obs: XbrlFactObservation,
  gaapTag: string,
  namespace: string,
  durationBucket: DurationBucket | null = null,
  derivedStandalone = false,
  priorObs: XbrlFactObservation | null = null
): void {
  // Prefer standalone quarter when available; otherwise keep the reported duration value
  // (e.g. 9M YTD) — never invent a fake "quarter" by relabeling YTD as Q3.
  row.metrics[key] = normalized ?? reported;
  row.metricDetails[key] = {
    reportedValue: reported,
    normalizedQuarterValue: normalized,
    durationDays: metricDurationDays,
    durationBucket,
    derivedStandalone,
    priorReportedValue: priorObs != null ? Number(priorObs.val) : null,
    priorEnd: priorObs ? observationEnd(priorObs) : null,
    priorAccn: priorObs?.accn ? String(priorObs.accn) : null,
    priorFiled: priorObs ? parseIsoDate(priorObs.filed) : null,
    priorForm: priorObs?.form ? String(priorObs.form) : null,
    priorDurationBucket: priorObs ? classifyDuration(durationDays(priorObs)) : null,
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
        const fy =
          resolveQuarterlyFiscalYear(observations, end) ??
          (pick.obs.fy != null ? Number(pick.obs.fy) : NaN);
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
          ns,
          pick.durationBucket,
          pick.derivedStandalone,
          pick.priorObs
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
        // Value may come from a later 10-K restatement; fy must come from the
        // original annual filing for this period end — not the restatement's fy.
        const fy = resolveAnnualFiscalYear(obsList, end) ?? NaN;
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
          ns,
          pick.durationBucket,
          pick.derivedStandalone,
          pick.priorObs
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
  periodAccessions: Map<string, string> = new Map(),
  durationPeriodByEnd: Map<string, DurationPeriodAnchor> = new Map()
): Map<string, RowDraft> {
  const rows = new Map<string, RowDraft>();

  for (const def of FINANCIAL_METRIC_DEFINITIONS) {
    if (def.valueType !== "instant") continue;
    const picks = collectInstantMetricsByPeriod(
      facts,
      def,
      scope,
      periodAccessions,
      durationPeriodByEnd
    );
    for (const [periodKey, pick] of picks) {
      const [fyStr, fp, end] = periodKey.split("|");
      const fy = Number(fyStr);
      if (!Number.isFinite(fy) || !end) continue;

      const instantEnd = observationEnd(pick.obs);
      // Cover-page DEI shares are dated after period end; allow when matched by accession.
      const isCoverPageShares =
        def.key === "shares_outstanding" &&
        pick.gaapTag === "EntityCommonStockSharesOutstanding";
      // Instant facts belong only to the period whose balance-sheet date equals the instant.
      if (instantEnd !== end && !isCoverPageShares) continue;

      const fpEnd = `${fp}|${end}`;
      const anchorKey = anchorByFpEnd.get(fpEnd);
      const canAnchor =
        Boolean(anchorKey) ||
        // Annual-only: allow balance-sheet-only FY rows (no duration facts).
        (scope === "annual" &&
          INSTANT_PRIMARY_METRICS.has(def.key) &&
          isLikelyFinancialPeriodEnd(pick.obs));
      if (!canAnchor) continue;

      const targetKey = anchorKey ?? periodKey;
      const [targetFy, targetFp, targetEnd] = targetKey.split("|");
      if (instantEnd !== targetEnd && !isCoverPageShares) continue;

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

function collectFinalizedPeriodRows(
  facts: SecCompanyFacts,
  scope: "annual" | "quarterly"
): FinancialPeriodRow[] {
  const durationRows = collectDurationRows(facts, scope);
  const anchorByFpEnd = new Map<string, string>();
  const periodAccessions = new Map<string, string>();
  const durationPeriodByEnd = new Map<string, DurationPeriodAnchor>();
  for (const [key, row] of durationRows) {
    const parts = key.split("|");
    const fy = Number(parts[0]);
    const fp = parts[1] as NormalizedFiscalPeriod;
    const end = parts[2]!;
    const fpEnd = `${fp}|${end}`;
    if (!anchorByFpEnd.has(fpEnd)) anchorByFpEnd.set(fpEnd, key);
    if (row.accessionNumber) periodAccessions.set(key, row.accessionNumber);
    // One duration identity per exact period end. Prefer existing (first) when
    // comparative filings also emit the same end under a different fy label.
    if (!durationPeriodByEnd.has(end) && Number.isFinite(fy) && fp && end) {
      durationPeriodByEnd.set(end, { fy, fp, key });
    }
  }
  const instantRows = collectInstantRows(
    facts,
    scope,
    anchorByFpEnd,
    periodAccessions,
    durationPeriodByEnd
  );
  const merged = mergeRowMaps(durationRows, instantRows);
  return finalizePeriodRows(rowsFromDrafts(merged), scope);
}

function buildPeriodRows(
  facts: SecCompanyFacts,
  scope: "annual" | "quarterly",
  limit: number
): FinancialPeriodRow[] {
  // Legacy path used by older call sites — enrich without cross-scope context.
  const rows = enrichPeriodRows(collectFinalizedPeriodRows(facts, scope), scope);
  return rows.slice(0, limit);
}

function metricPeriodLabel(
  rowFp: string | null | undefined,
  detail: MetricValueDetail | undefined
): string | null {
  if (!detail) return rowFp ?? null;
  // Cash-flow / duration YTD facts must keep their duration label even on a Q3 row.
  if (isYtdDurationBucket(detail.durationBucket) && !detail.derivedStandalone) {
    return durationBucketLabel(detail.durationBucket) ?? rowFp ?? null;
  }
  if (isYtdDurationBucket(detail.durationBucket) && detail.derivedStandalone) {
    // Derived standalone quarter — label as the fiscal quarter.
    return rowFp ?? null;
  }
  return durationBucketLabel(detail.durationBucket) ?? rowFp ?? null;
}

function cashFlowDisplayValue(
  row: FinancialPeriodRow,
  key: FinancialMetricKey
): number | null {
  const detail = row.metricDetails[key];
  const metric = row.metrics[key];
  if (detail && isYtdDurationBucket(detail.durationBucket)) {
    // Statement panel shows the filing's reported YTD figures with a YTD label.
    return detail.reportedValue;
  }
  return metric ?? null;
}

function buildLatestFromRows(rows: FinancialPeriodRow[]): Partial<Record<FinancialMetricKey, ExtractedMetricValue>> {
  const latest: Partial<Record<FinancialMetricKey, ExtractedMetricValue>> = {};
  const row = rows[0];
  if (!row) return latest;
  for (const def of FINANCIAL_METRIC_DEFINITIONS) {
    const value = row.metrics[def.key];
    const source = row.metricSources[def.key];
    const detail = row.metricDetails[def.key];
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
      periodLabel: metricPeriodLabel(row.fp, detail),
      fy: row.fy,
      gaapTag: source.gaapTag,
      namespace: source.namespace,
      durationBucket: detail?.durationBucket ?? null,
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

function cashFlowPeriodLabel(
  rowFp: string | null | undefined,
  detail: MetricValueDetail | undefined
): string | null {
  // Cash-flow statement shows filing-reported duration values with duration labels.
  if (detail && isYtdDurationBucket(detail.durationBucket)) {
    return durationBucketLabel(detail.durationBucket);
  }
  return rowFp ?? null;
}

function buildDerivationProvenance(
  detail: MetricValueDetail | undefined
): CashFlowDerivationProvenance | null {
  if (
    !detail?.derivedStandalone ||
    detail.priorReportedValue == null ||
    !Number.isFinite(detail.priorReportedValue)
  ) {
    return null;
  }
  return {
    method: "ytd_minus_prior_ytd",
    current: {
      value: detail.reportedValue,
      end: null, // filled by caller with row end
      accn: null,
      filed: null,
      form: null,
      durationBucket: detail.durationBucket ?? null,
    },
    prior: {
      value: detail.priorReportedValue,
      end: detail.priorEnd ?? null,
      accn: detail.priorAccn ?? null,
      filed: detail.priorFiled ?? null,
      form: detail.priorForm ?? null,
      durationBucket: detail.priorDurationBucket ?? null,
    },
  };
}

function completeDerivationProvenance(
  detail: MetricValueDetail | undefined,
  source: MetricSourceRef | undefined,
  rowEnd: string
): CashFlowDerivationProvenance | null {
  const base = buildDerivationProvenance(detail);
  if (!base) return null;
  return {
    ...base,
    current: {
      ...base.current,
      end: rowEnd,
      accn: source?.accn ?? null,
      filed: source?.filed ?? null,
      form: source?.form ?? null,
    },
  };
}

function buildCashFlowLatestFromRow(
  row: FinancialPeriodRow,
  mode: "reported" | "derived_quarter"
): CashFlowLatestMetrics {
  const latest: CashFlowLatestMetrics = {};
  for (const def of FINANCIAL_METRIC_DEFINITIONS) {
    if (def.statement !== "cashflow") continue;
    const source = row.metricSources[def.key];
    const detail = row.metricDetails[def.key];
    if (!source) continue;

    if (mode === "reported") {
      const value = cashFlowDisplayValue(row, def.key);
      if (value == null) continue;
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
        periodLabel: cashFlowPeriodLabel(row.fp, detail),
        fy: row.fy,
        gaapTag: source.gaapTag,
        namespace: source.namespace,
        durationBucket: detail?.durationBucket ?? null,
      };
      continue;
    }

    // derived_quarter: only include metrics actually derived from YTD − prior YTD
    if (
      !detail?.derivedStandalone ||
      detail.normalizedQuarterValue == null ||
      !Number.isFinite(detail.normalizedQuarterValue)
    ) {
      continue;
    }
    const derivation = completeDerivationProvenance(detail, source, row.end);
    latest[def.key] = {
      key: def.key,
      label: def.label,
      value: detail.normalizedQuarterValue,
      unit: def.unit,
      end: null,
      filed: source.filed,
      form: source.form,
      accn: source.accn,
      fp: row.fp,
      periodLabel: row.fp ? `${row.fp} · derived` : "derived",
      fy: row.fy,
      gaapTag: source.gaapTag,
      namespace: source.namespace,
      durationBucket: detail.durationBucket ?? null,
      derivation,
    };
  }

  const ocf =
    mode === "reported"
      ? latest.operating_cash_flow?.value
      : latest.operating_cash_flow?.value;
  const capex =
    mode === "reported"
      ? latest.capital_expenditures?.value
      : latest.capital_expenditures?.value;
  if (ocf != null && capex != null) {
    const ocfDetail = row.metricDetails.operating_cash_flow;
    const ocfSource = row.metricSources.operating_cash_flow;
    latest.free_cash_flow = {
      value: Math.round((ocf - Math.abs(capex)) * 100) / 100,
      unit: "USD",
      end: mode === "reported" ? row.end : null,
      fp: row.fp,
      periodLabel:
        mode === "reported"
          ? cashFlowPeriodLabel(row.fp, ocfDetail)
          : row.fp
            ? `${row.fp} · derived`
            : "derived",
      derivation:
        mode === "derived_quarter"
          ? completeDerivationProvenance(ocfDetail, ocfSource, row.end)
          : null,
    };
  }
  return latest;
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

  if (statement === "cashflow") {
    const latest = latestSource ? buildCashFlowLatestFromRow(latestSource, "reported") : {};
    const latestDerivedQuarter = latestSource
      ? buildCashFlowLatestFromRow(latestSource, "derived_quarter")
      : undefined;
    const derivedCount = latestDerivedQuarter
      ? Object.keys(latestDerivedQuarter).filter((k) => k !== "free_cash_flow").length
      : 0;
    return {
      latest,
      latestDerivedQuarter: derivedCount > 0 ? latestDerivedQuarter : undefined,
      annual: annualFiltered,
      quarterly: quarterlyFiltered,
    };
  }

  const latest: CashFlowLatestMetrics = {};
  if (latestSource) {
    for (const def of FINANCIAL_METRIC_DEFINITIONS) {
      if (def.statement !== statement) continue;
      const source = latestSource.metricSources[def.key];
      const detail = latestSource.metricDetails[def.key];
      const value = latestSource.metrics[def.key] ?? null;
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
        periodLabel: metricPeriodLabel(latestSource.fp, detail),
        fy: latestSource.fy,
        gaapTag: source.gaapTag,
        namespace: source.namespace,
        durationBucket: detail?.durationBucket ?? null,
      };
    }
  }

  // If the latest quarter omitted period-end shares (common), surface the newest
  // published shares from any balance-sheet period so the panel is not blank.
  if (statement === "balance" && !latest.shares_outstanding) {
    const pool = [...quarterlyFiltered, ...annualFiltered]
      .filter(
        (r) =>
          r.metrics.shares_outstanding != null &&
          Number.isFinite(r.metrics.shares_outstanding) &&
          r.metricSources.shares_outstanding
      )
      .sort((a, b) => String(b.end ?? "").localeCompare(String(a.end ?? "")));
    const shareRow = pool[0];
    if (shareRow) {
      const source = shareRow.metricSources.shares_outstanding!;
      const detail = shareRow.metricDetails.shares_outstanding;
      latest.shares_outstanding = {
        key: "shares_outstanding",
        label: "Shares outstanding",
        value: shareRow.metrics.shares_outstanding!,
        unit: "shares",
        end: shareRow.end,
        filed: source.filed,
        form: source.form,
        accn: source.accn,
        fp: shareRow.fp,
        periodLabel: metricPeriodLabel(shareRow.fp, detail),
        fy: shareRow.fy,
        gaapTag: source.gaapTag,
        namespace: source.namespace,
        durationBucket: detail?.durationBucket ?? null,
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
  // Keep enough quarters for TTM NI (4) + beginning balance-sheet point.
  const quarterlyLimit = Math.min(24, Math.max(1, options.quarterlyLimit ?? 8));

  let annual = collectFinalizedPeriodRows(facts, "annual");
  let quarterly = collectFinalizedPeriodRows(facts, "quarterly");

  const ctx = { annual, quarterly };
  annual = enrichPeriodRows(annual, "annual", ctx);
  quarterly = enrichPeriodRows(quarterly, "quarterly", ctx);
  quarterly = validateQuarterlyRevenue(quarterly, annual);

  return {
    annual: annual.slice(0, annualLimit),
    quarterly: quarterly.slice(0, quarterlyLimit),
  };
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
