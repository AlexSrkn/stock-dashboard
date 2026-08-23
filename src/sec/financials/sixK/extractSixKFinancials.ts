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

export interface SixKExtractionResult {
  filing: SecFinancialFilingRow;
  documentName: string;
  row: FinancialPeriodRow;
  source: "6k-xbrl";
}

function inferFiscalYear(end: string): number | null {
  const y = Number(end.slice(0, 4));
  return Number.isFinite(y) ? y : null;
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
      namespace: "6k-xbrl",
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
    inclusionReason: `6-K XBRL (${documentName})`,
  };
}

function pickBestContextRow(
  filing: SecFinancialFilingRow,
  documentName: string,
  content: string
): FinancialPeriodRow | null {
  const parsed = parseXbrlDocument(content);
  const byContext = mapFactsToMetrics(parsed);
  if (!byContext.size) return null;

  let best: {
    contextId: string;
    end: string;
    start: string | null;
    metricCount: number;
  } | null = null;

  for (const [contextId, metrics] of byContext) {
    const ctx = parsed.contexts.get(contextId);
    const end = ctx?.end ?? ctx?.instant;
    if (!end) continue;
    const metricCount = Object.keys(metrics).length;
    if (!best || metricCount > best.metricCount) {
      best = { contextId, end, start: ctx?.start ?? null, metricCount };
    }
  }
  if (!best || best.metricCount < 2) return null;

  const duration = best.start
    ? classifyDuration(durationDays({ start: best.start, end: best.end, val: 0 }))
    : "annual_ytd";

  // Merge instant (balance-sheet) facts from the same period end into the
  // duration income/cash-flow context — 6-K H1 filings usually split them.
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

async function loadSixKXbrlDocument(
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

/** Extract one interim period from a 6-K filing's XBRL (instance or exhibit). */
export async function extractSixKFinancialPeriod(
  filerCik: number | string,
  filing: SecFinancialFilingRow
): Promise<SixKExtractionResult | null> {
  if (!is10QForm(filing.form)) return null;

  const ref: EdgarFilingRef = { filerCik, accessionNumber: filing.accessionNumber };
  const index = await fetchEdgarFilingIndex(ref);
  const items = normalizeIndexItems(index.directory?.item);
  if (!filingHasFinancialXbrl(items)) return null;

  const doc = await loadSixKXbrlDocument(ref, items);
  if (!doc) return null;

  const row = pickBestContextRow(filing, doc.documentName, doc.content);
  if (!row) return null;

  return { filing, documentName: doc.documentName, row, source: "6k-xbrl" };
}

export interface SupplementSixKOptions {
  maxFilings?: number;
  annualRows?: FinancialPeriodRow[];
}

/**
 * Add newer interim periods from recent financial 6-K XBRL when companyfacts lag.
 * Only scans a few candidate filings; failures are non-fatal.
 */
export async function supplementQuarterlyFromLatestSixK(
  filerCik: number | string,
  candidateFilings: SecFinancialFilingRow[],
  existingQuarterly: FinancialPeriodRow[],
  options: SupplementSixKOptions = {}
): Promise<FinancialPeriodRow[]> {
  const maxFilings = Math.min(4, Math.max(1, options.maxFilings ?? 3));
  const existingKeys = new Set(existingQuarterly.map((row) => `${row.fp}|${row.end}`));
  const added: FinancialPeriodRow[] = [];

  for (const filing of candidateFilings.slice(0, maxFilings)) {
    try {
      const result = await extractSixKFinancialPeriod(filerCik, filing);
      if (!result?.row) continue;
      const key = `${result.row.fp}|${result.row.end}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
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
