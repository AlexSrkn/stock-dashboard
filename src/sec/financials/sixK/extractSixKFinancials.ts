import { enrichPeriodRows } from "../derivedMetrics.js";
import {
  classifyDuration,
  durationDays,
  is10QForm,
  normalizeFiscalPeriod,
} from "../periodUtils.js";
import type { FinancialPeriodRow, SecFinancialFilingRow } from "../types.js";
import {
  fetchEdgarDocument,
  fetchEdgarFilingIndex,
  normalizeIndexItems,
  type EdgarFilingRef,
} from "./edgarFetch.js";
import {
  filingHasFinancialXbrl,
  pickBestSixKFinancialExhibit,
  pickSixKInstanceXml,
} from "./findFinancialExhibit.js";
import { mapFactsToMetrics, parseXbrlDocument } from "./parseXbrlDocument.js";

export interface FilingXbrlExtractionResult {
  filing: SecFinancialFilingRow;
  documentName: string;
  row: FinancialPeriodRow;
  source: "6k-xbrl" | "10q-xbrl";
}

/** @deprecated Use FilingXbrlExtractionResult */
export type SixKExtractionResult = FilingXbrlExtractionResult;

function inferFiscalYear(end: string): number | null {
  const y = Number(end.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function xbrlSourceLabel(form: string | null | undefined): "6k-xbrl" | "10q-xbrl" {
  const f = String(form || "").toUpperCase();
  return f.startsWith("10-Q") ? "10q-xbrl" : "6k-xbrl";
}

function buildRowFromMetrics(
  filing: SecFinancialFilingRow,
  documentName: string,
  metrics: Partial<Record<string, { value: number; tag: string; contextRef: string }>>,
  contextEnd: string,
  contextStart: string | null
): FinancialPeriodRow | null {
  const end = contextEnd.slice(0, 10);
  const filed = filing.filingDate?.slice(0, 10) ?? null;
  const source = xbrlSourceLabel(filing.form);
  const obsLike = {
    form: filing.form,
    fp: contextStart ? "Q2" : "FY",
    fy: inferFiscalYear(end),
    end,
    start: contextStart,
    filed,
    accn: filing.accessionNumber,
  };
  const fp = normalizeFiscalPeriod(obsLike as never, contextStart ? "quarterly" : "annual");
  if (!fp) return null;

  const metricValues: FinancialPeriodRow["metrics"] = {};
  const metricSources: FinancialPeriodRow["metricSources"] = {};
  for (const [key, pick] of Object.entries(metrics)) {
    if (!pick) continue;
    metricValues[key as keyof typeof metricValues] = pick.value;
    metricSources[key as keyof typeof metricSources] = {
      gaapTag: pick.tag,
      namespace: source,
      accn: filing.accessionNumber,
      filed,
      form: filing.form,
    };
  }
  if (!Object.keys(metricValues).length) return null;

  return {
    end,
    filed,
    form: filing.form,
    fp,
    fy: inferFiscalYear(end),
    accessionNumber: filing.accessionNumber,
    metrics: metricValues,
    metricDetails: {},
    metricSources,
    derived: {},
    inclusionReason: `${source === "10q-xbrl" ? "10-Q" : "6-K"} XBRL (${documentName})`,
  };
}

function scoreContextCandidate(
  end: string,
  start: string | null,
  metricCount: number,
  preferredPeriodEnd: string | null
): number {
  let score = metricCount;
  const endDay = end.slice(0, 10);
  if (preferredPeriodEnd && endDay === preferredPeriodEnd) score += 10_000;
  if (start) {
    const bucket = classifyDuration(durationDays({ start, end: endDay, val: 0 }));
    // Prefer standalone quarter over YTD when the filing has both.
    if (bucket === "quarter") score += 5_000;
    else if (bucket === "h1_ytd") score += 1_000;
    else if (bucket === "nine_m_ytd") score += 500;
  } else {
    // Instant-only contexts are useful for balance sheet merge, not as the primary row.
    score -= 50;
  }
  return score;
}

function pickBestContextRow(
  filing: SecFinancialFilingRow,
  documentName: string,
  content: string,
  preferredPeriodEnd: string | null = null
): FinancialPeriodRow | null {
  const parsed = parseXbrlDocument(content);
  const byContext = mapFactsToMetrics(parsed);
  if (!byContext.size) return null;

  let best: {
    contextId: string;
    end: string;
    start: string | null;
    metricCount: number;
    score: number;
  } | null = null;

  for (const [contextId, metrics] of byContext) {
    const ctx = parsed.contexts.get(contextId);
    const end = ctx?.end ?? ctx?.instant;
    if (!end) continue;
    const metricCount = Object.keys(metrics).length;
    const start = ctx?.start ?? null;
    const score = scoreContextCandidate(end, start, metricCount, preferredPeriodEnd);
    if (!best || score > best.score) {
      best = { contextId, end, start, metricCount, score };
    }
  }
  if (!best || best.metricCount < 2) return null;

  const duration = best.start
    ? classifyDuration(durationDays({ start: best.start, end: best.end, val: 0 }))
    : "annual_ytd";

  // Merge instant (balance-sheet) facts from the same period end into the
  // duration income/cash-flow context — filings usually split them.
  const merged = { ...(byContext.get(best.contextId) ?? {}) };
  const bestEnd = best.end.slice(0, 10);
  for (const [contextId, metrics] of byContext) {
    if (contextId === best.contextId) continue;
    const ctx = parsed.contexts.get(contextId);
    const instant = (ctx?.instant ?? (!ctx?.start ? ctx?.end : null))?.slice(0, 10);
    if (!instant || instant !== bestEnd) continue;
    for (const [key, pick] of Object.entries(metrics)) {
      if (!pick) continue;
      if (merged[key as keyof typeof merged] != null) continue;
      merged[key as keyof typeof merged] = pick;
    }
  }
  return buildRowFromMetrics(
    filing,
    documentName,
    merged,
    best.end,
    duration === "quarter" || duration === "h1_ytd" || duration === "nine_m_ytd" ? best.start : null
  );
}

async function loadFilingXbrlDocument(
  ref: EdgarFilingRef,
  items: ReturnType<typeof normalizeIndexItems>
): Promise<{ documentName: string; content: string } | null> {
  const instanceXml = pickSixKInstanceXml(items);
  if (instanceXml) {
    const content = await fetchEdgarDocument(ref, instanceXml);
    if (content.includes("contextRef") || content.includes("ix:nonFraction")) {
      return { documentName: instanceXml, content };
    }
  }

  const exhibit = pickBestSixKFinancialExhibit(items);
  if (!exhibit) return null;
  const content = await fetchEdgarDocument(ref, exhibit.documentName);
  if (!content.includes("ix:nonFraction") && !content.includes("contextRef")) return null;
  return { documentName: exhibit.documentName, content };
}

export interface ExtractFilingFinancialOptions {
  /** Prefer contexts ending on this date (typically the 10-Q reportDate). */
  preferredPeriodEnd?: string | null;
}

/** Extract one interim period from a 10-Q / 6-K filing's XBRL (instance or exhibit). */
export async function extractFilingFinancialPeriod(
  filerCik: number | string,
  filing: SecFinancialFilingRow,
  options: ExtractFilingFinancialOptions = {}
): Promise<FilingXbrlExtractionResult | null> {
  if (!is10QForm(filing.form)) return null;

  const ref: EdgarFilingRef = { filerCik, accessionNumber: filing.accessionNumber };
  const index = await fetchEdgarFilingIndex(ref);
  const items = normalizeIndexItems(index.directory?.item);
  if (!filingHasFinancialXbrl(items)) return null;

  const doc = await loadFilingXbrlDocument(ref, items);
  if (!doc) return null;

  const preferred =
    options.preferredPeriodEnd?.slice(0, 10) ||
    filing.reportDate?.slice(0, 10) ||
    null;
  const row = pickBestContextRow(filing, doc.documentName, doc.content, preferred);
  if (!row) return null;

  return {
    filing,
    documentName: doc.documentName,
    row,
    source: xbrlSourceLabel(filing.form),
  };
}

/** @deprecated Use extractFilingFinancialPeriod */
export async function extractSixKFinancialPeriod(
  filerCik: number | string,
  filing: SecFinancialFilingRow
): Promise<FilingXbrlExtractionResult | null> {
  return extractFilingFinancialPeriod(filerCik, filing);
}

export interface SupplementFilingXbrlOptions {
  maxFilings?: number;
  annualRows?: FinancialPeriodRow[];
}

async function supplementQuarterlyFromFilingXbrl(
  filerCik: number | string,
  candidateFilings: SecFinancialFilingRow[],
  existingQuarterly: FinancialPeriodRow[],
  options: SupplementFilingXbrlOptions = {}
): Promise<FinancialPeriodRow[]> {
  const maxFilings = Math.min(4, Math.max(1, options.maxFilings ?? 3));
  const existingKeys = new Set(existingQuarterly.map((row) => `${row.fp}|${row.end}`));
  const existingEnds = new Set(
    existingQuarterly.map((row) => row.end?.slice(0, 10)).filter(Boolean) as string[]
  );
  const added: FinancialPeriodRow[] = [];

  for (const filing of candidateFilings.slice(0, maxFilings)) {
    try {
      const result = await extractFilingFinancialPeriod(filerCik, filing, {
        preferredPeriodEnd: filing.reportDate,
      });
      if (!result?.row) continue;
      const endKey = result.row.end?.slice(0, 10);
      if (endKey && existingEnds.has(endKey)) continue;
      const key = `${result.row.fp}|${result.row.end}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      if (endKey) existingEnds.add(endKey);
      const [enriched] = enrichPeriodRows([result.row], "quarterly", {
        annual: options.annualRows ?? [],
        quarterly: [...existingQuarterly, ...added],
      });
      added.push(enriched ?? result.row);
      break;
    } catch {
      // Non-fatal — companyfacts remains primary.
    }
  }

  if (!added.length) return existingQuarterly;
  return [...existingQuarterly, ...added].sort((a, b) => String(b.end).localeCompare(String(a.end)));
}

/**
 * Add newer interim periods from recent financial 6-K XBRL when companyfacts lag.
 * Only scans a few candidate filings; failures are non-fatal.
 */
export async function supplementQuarterlyFromLatestSixK(
  filerCik: number | string,
  candidateFilings: SecFinancialFilingRow[],
  existingQuarterly: FinancialPeriodRow[],
  options: SupplementFilingXbrlOptions = {}
): Promise<FinancialPeriodRow[]> {
  return supplementQuarterlyFromFilingXbrl(
    filerCik,
    candidateFilings,
    existingQuarterly,
    options
  );
}

/**
 * Add newer US 10-Q periods from filing XBRL when Company Facts lag submissions.
 */
export async function supplementQuarterlyFromLatestTenQ(
  filerCik: number | string,
  candidateFilings: SecFinancialFilingRow[],
  existingQuarterly: FinancialPeriodRow[],
  options: SupplementFilingXbrlOptions = {}
): Promise<FinancialPeriodRow[]> {
  return supplementQuarterlyFromFilingXbrl(
    filerCik,
    candidateFilings,
    existingQuarterly,
    options
  );
}
