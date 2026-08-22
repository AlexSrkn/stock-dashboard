import { classifyDuration, durationDays, is10QForm, normalizeFiscalPeriod } from "../periodUtils.js";
import type { FinancialPeriodRow, SecFinancialFilingRow } from "../types.js";
import {
  fetchEdgarDocument,
  fetchEdgarFilingIndex,
  normalizeIndexItems,
  type EdgarFilingRef,
} from "../filingIndex.js";
import { pickBestSixKFinancialExhibit } from "./findFinancialExhibit.js";
import { mapInlineFactsToMetrics, parseInlineXbrl } from "./parseInlineXbrl.js";

export interface SixKExtractionResult {
  filing: SecFinancialFilingRow;
  exhibitDocument: string;
  row: FinancialPeriodRow | null;
  source: "6k-exhibit";
}

function inferFiscalYear(end: string): number | null {
  const y = Number(end.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function buildRowFromExhibit(
  filing: SecFinancialFilingRow,
  exhibitDocument: string,
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
      namespace: "inline-xbrl",
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
    inclusionReason: "6-K exhibit inline XBRL",
  };
}

/** Extract one interim period from a 6-K filing's best financial exhibit. */
export async function extractSixKFinancialPeriod(
  filerCik: number | string,
  filing: SecFinancialFilingRow
): Promise<SixKExtractionResult | null> {
  if (!is10QForm(filing.form)) return null;
  const ref: EdgarFilingRef = { filerCik, accessionNumber: filing.accessionNumber };
  const index = await fetchEdgarFilingIndex(ref);
  const items = normalizeIndexItems(index.directory?.item);
  const exhibit = pickBestSixKFinancialExhibit(items);
  if (!exhibit) return null;

  const html = await fetchEdgarDocument(ref, exhibit.documentName);
  if (!html.includes("ix:nonFraction") && !html.includes("inlineXBRL")) return null;

  const parsed = parseInlineXbrl(html);
  const byContext = mapInlineFactsToMetrics(parsed);
  if (!byContext.size) return null;

  let best: { contextId: string; end: string; start: string | null; metricCount: number } | null =
    null;
  for (const [contextId, metrics] of byContext) {
    const ctx = parsed.contexts.get(contextId);
    const end = ctx?.end ?? ctx?.instant;
    if (!end) continue;
    const metricCount = Object.keys(metrics).length;
    if (!best || metricCount > best.metricCount) {
      best = { contextId, end, start: ctx?.start ?? null, metricCount };
    }
  }
  if (!best) return null;

  const duration = best.start
    ? classifyDuration(durationDays({ start: best.start, end: best.end, val: 0 }))
    : "annual_ytd";
  const row = buildRowFromExhibit(
    filing,
    exhibit.documentName,
    byContext.get(best.contextId)!,
    best.end,
    duration === "quarter" || duration === "h1_ytd" || duration === "nine_m_ytd" ? best.start : null
  );
  if (!row) return null;

  return { filing, exhibitDocument: exhibit.documentName, row, source: "6k-exhibit" };
}

/** Supplement companyfacts quarterly rows with newer 6-K exhibit periods. */
export async function supplementQuarterlyFromSixKExhibits(
  filerCik: number | string,
  sixKFilings: SecFinancialFilingRow[],
  existingQuarterly: FinancialPeriodRow[],
  maxFilings = 4
): Promise<FinancialPeriodRow[]> {
  const existingEnds = new Set(existingQuarterly.map((r) => `${r.fp}|${r.end}`));
  const added: FinancialPeriodRow[] = [];

  for (const filing of sixKFilings.slice(0, maxFilings)) {
    try {
      const result = await extractSixKFinancialPeriod(filerCik, filing);
      if (!result?.row) continue;
      const key = `${result.row.fp}|${result.row.end}`;
      if (existingEnds.has(key)) continue;
      existingEnds.add(key);
      added.push(result.row);
    } catch {
      // Non-fatal — companyfacts remains primary source.
    }
  }

  return [...existingQuarterly, ...added].sort((a, b) => String(b.end).localeCompare(String(a.end)));
}
