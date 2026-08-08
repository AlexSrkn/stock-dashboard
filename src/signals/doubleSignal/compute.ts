import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getInstitutionActivity, listTrackedInstitutions } from "../../institution/institutionAnalytics.js";
import type {
  DoubleSignalDetailPayload,
  DoubleSignalInstitutionOption,
  DoubleSignalPayload,
  DoubleSignalRow,
  DoubleSignalSummary,
  DoubleSignalTimelineEvent,
  DoubleSignalWindowDays,
  InsiderBuyEvent,
  InstitutionalBuyEvent,
} from "./types.js";
import {
  SELECT_INSIDER_BUYS_IN_WINDOW_SQL,
  SELECT_LATEST_13F_FILING_DATE_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
  trackedInstitutionCiks,
} from "./queries.js";
import { computeSignalStrengthScore } from "./score.js";

const BATCH_SIZE = 8;

function parseIsoDate(value: string | null | undefined): number {
  if (!value) return 0;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return Date.parse(value) || 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadLatest13fFilingDate(pool: pg.Pool): Promise<string | null> {
  const ciks = trackedInstitutionCiks();
  const res = await pool.query<{ latest_filing_date: string | null }>(
    SELECT_LATEST_13F_FILING_DATE_SQL,
    [ciks]
  );
  return res.rows[0]?.latest_filing_date ?? null;
}

async function loadInsiderBuyEvents(
  windowDays: DoubleSignalWindowDays,
  pool: pg.Pool
): Promise<InsiderBuyEvent[]> {
  const res = await pool.query<InsiderBuyEvent>(SELECT_INSIDER_BUYS_IN_WINDOW_SQL, [windowDays]);
  return res.rows.filter((r) => r.ticker && r.insiderName);
}

async function loadInstitutionalBuyEvents(
  windowDays: DoubleSignalWindowDays,
  pool: pg.Pool
): Promise<InstitutionalBuyEvent[]> {
  const funds = listTrackedInstitutions();
  const windowStartMs = parseIsoDate(isoDateDaysAgo(windowDays));
  const events: InstitutionalBuyEvent[] = [];

  for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    const batchEvents = await Promise.all(
      batch.map(async (fund) => {
        const activity = await getInstitutionActivity(pool, fund.cik, 5000);
        if (!activity?.meta.currentQuarter) return [];

        const filingMs = parseIsoDate(activity.meta.latestFilingDate);
        if (filingMs < windowStartMs) return [];

        const rows: InstitutionalBuyEvent[] = [];
        const pushRow = (
          row: (typeof activity.newPositions)[number],
          buyType: InstitutionalBuyEvent["buyType"]
        ) => {
          const ticker = row.ticker ? String(row.ticker).trim().toUpperCase() : null;
          rows.push({
            institutionId: fund.cik,
            institutionName: fund.name,
            institutionType: fund.type,
            cusip: row.cusip,
            ticker,
            companyName: row.issuer ? String(row.issuer) : null,
            buyType,
            positionValueUsd: row.currentValueUsd,
            sharesChange: row.sharesChange,
            currentShares: row.currentShares,
            filingDate: activity.meta.latestFilingDate,
            quarter: activity.meta.currentQuarter,
          });
        };

        for (const row of activity.newPositions) {
          if (row.currentShares > 0) pushRow(row, "new");
        }
        for (const row of activity.adds) {
          if (row.sharesChange > 0) pushRow(row, "increase");
        }
        return rows;
      })
    );
    events.push(...batchEvents.flat());
  }

  return events;
}

async function loadStockEnrichment(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  if (!tickers.length) return new Map();
  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string | null;
  }>(SELECT_STOCK_ENRICHMENT_SQL, [tickers]);
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  for (const row of res.rows) {
    out.set(String(row.ticker).toUpperCase(), {
      companyName: row.company_name ? String(row.company_name) : null,
      sector: row.sector ? String(row.sector) : null,
    });
  }
  return out;
}

function resolveTickerKey(
  event: InstitutionalBuyEvent,
  cusipToTicker: Map<string, string>
): string | null {
  if (event.ticker) return event.ticker;
  return cusipToTicker.get(event.cusip) ?? null;
}

function buildCusipToTickerMap(instEvents: InstitutionalBuyEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of instEvents) {
    if (e.ticker) map.set(e.cusip, e.ticker);
  }
  return map;
}

function groupInstitutionalByTicker(
  events: InstitutionalBuyEvent[]
): Map<string, InstitutionalBuyEvent[]> {
  const cusipToTicker = buildCusipToTickerMap(events);
  const byTicker = new Map<string, InstitutionalBuyEvent[]>();

  for (const event of events) {
    const ticker = resolveTickerKey(event, cusipToTicker);
    if (!ticker) continue;
    const list = byTicker.get(ticker) ?? [];
    list.push({ ...event, ticker });
    byTicker.set(ticker, list);
  }
  return byTicker;
}

function groupInsiderByTicker(events: InsiderBuyEvent[]): Map<string, InsiderBuyEvent[]> {
  const byTicker = new Map<string, InsiderBuyEvent[]>();
  for (const event of events) {
    const ticker = String(event.ticker || "").trim().toUpperCase();
    if (!ticker) continue;
    const list = byTicker.get(ticker) ?? [];
    list.push(event);
    byTicker.set(ticker, list);
  }
  return byTicker;
}

function buildSummary(
  signals: DoubleSignalRow[],
  instEvents: InstitutionalBuyEvent[],
  insiderEvents: InsiderBuyEvent[]
): DoubleSignalSummary {
  const institutionIds = new Set(instEvents.map((e) => e.institutionId));
  return {
    totalDoubleSignals: signals.length,
    uniqueStocks: signals.length,
    institutionsInvolved: institutionIds.size,
    insiderPurchases: insiderEvents.length,
  };
}

function insiderRoleFlags(events: InsiderBuyEvent[]): DoubleSignalRow["insiderRoles"] {
  let ceo = false;
  let officer = false;
  let director = false;
  for (const e of events) {
    const t = String(e.insiderTitle || "");
    if (/\bceo\b|chief executive/i.test(t)) ceo = true;
    if (/\bdirector\b/i.test(t)) director = true;
    if (/\bofficer\b|\bpresident\b|\bcfo\b|\bcoo\b|\bchief\b/i.test(t)) officer = true;
  }
  return { ceo, officer, director };
}

function buildSignals(
  instByTicker: Map<string, InstitutionalBuyEvent[]>,
  insiderByTicker: Map<string, InsiderBuyEvent[]>,
  enrichment: Map<string, { companyName: string | null; sector: string | null }>
): DoubleSignalRow[] {
  const signals: DoubleSignalRow[] = [];

  for (const [ticker, instEvents] of instByTicker) {
    const insiderEvents = insiderByTicker.get(ticker);
    if (!insiderEvents?.length) continue;

    const institutionIds = new Set(instEvents.map((e) => e.institutionId));
    const insiderNames = new Set(
      insiderEvents.map((e) => String(e.insiderName || "").trim().toLowerCase()).filter(Boolean)
    );

    const instValues = instEvents
      .map((e) => e.positionValueUsd ?? 0)
      .filter((v) => Number.isFinite(v) && v > 0);
    const insiderValues = insiderEvents
      .map((e) => Math.abs(Number(e.transactionValue) || 0))
      .filter((v) => Number.isFinite(v) && v > 0);

    const totalInstitutionalValueUsd = instValues.reduce((s, v) => s + v, 0);
    const totalInsiderPurchaseUsd = insiderValues.reduce((s, v) => s + v, 0);
    const largestInstitutionalPositionUsd = instValues.length ? Math.max(...instValues) : null;
    const largestInsiderPurchaseUsd = insiderValues.length ? Math.max(...insiderValues) : 0;

    const instDates = instEvents.map((e) => parseIsoDate(e.filingDate)).filter((d) => d > 0);
    const insiderDates = insiderEvents
      .map((e) => parseIsoDate(e.transactionDate))
      .filter((d) => d > 0);

    const meta = enrichment.get(ticker);
    const companyName =
      meta?.companyName ??
      instEvents.find((e) => e.companyName)?.companyName ??
      null;
    const cusip = instEvents.find((e) => e.cusip)?.cusip ?? null;

    signals.push({
      ticker,
      companyName,
      sector: meta?.sector ?? null,
      cusip,
      institutionCount: institutionIds.size,
      institutionIds: [...institutionIds],
      insiderPurchaseCount: insiderNames.size,
      insiderRoles: insiderRoleFlags(insiderEvents),
      largestInstitutionalPositionUsd,
      largestInsiderPurchaseUsd,
      latestInstitutionalFilingDate:
        instDates.length > 0
          ? instEvents
              .slice()
              .sort((a, b) => parseIsoDate(b.filingDate) - parseIsoDate(a.filingDate))[0]
              ?.filingDate ?? null
          : null,
      latestInsiderPurchaseDate:
        insiderDates.length > 0
          ? insiderEvents
              .slice()
              .sort((a, b) => parseIsoDate(b.transactionDate) - parseIsoDate(a.transactionDate))[0]
              ?.transactionDate ?? null
          : null,
      totalInstitutionalValueUsd: Math.round(totalInstitutionalValueUsd),
      totalInsiderPurchaseUsd: Math.round(totalInsiderPurchaseUsd),
      signalStrengthScore: computeSignalStrengthScore({
        institutionCount: institutionIds.size,
        insiderPurchaseCount: insiderNames.size,
        totalInstitutionalValueUsd,
        totalInsiderPurchaseUsd,
      }),
    });
  }

  return signals.sort(
    (a, b) =>
      b.signalStrengthScore - a.signalStrengthScore ||
      b.institutionCount - a.institutionCount ||
      b.insiderPurchaseCount - a.insiderPurchaseCount
  );
}

export function buildTimeline(
  instEvents: InstitutionalBuyEvent[],
  insiderEvents: InsiderBuyEvent[]
): DoubleSignalTimelineEvent[] {
  const timeline: DoubleSignalTimelineEvent[] = [];

  for (const e of instEvents) {
    const date = e.filingDate ?? "";
    if (!date) continue;
    timeline.push({
      date,
      type: "institution",
      label: e.institutionName,
      detail: e.buyType === "new" ? "New position" : "Position increase",
      valueUsd: e.positionValueUsd,
    });
  }

  for (const e of insiderEvents) {
    const date = e.transactionDate ?? "";
    if (!date) continue;
    timeline.push({
      date,
      type: "insider",
      label: e.insiderName,
      detail: e.insiderTitle ? String(e.insiderTitle) : "Open-market purchase",
      valueUsd: Math.abs(Number(e.transactionValue) || 0) || null,
    });
  }

  return timeline.sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
}

export async function computeDoubleSignals(
  windowDays: DoubleSignalWindowDays,
  pool: pg.Pool = getPool()
): Promise<DoubleSignalPayload> {
  const [latest13fFilingDate, instEvents, insiderEvents] = await Promise.all([
    loadLatest13fFilingDate(pool),
    loadInstitutionalBuyEvents(windowDays, pool),
    loadInsiderBuyEvents(windowDays, pool),
  ]);

  const instByTicker = groupInstitutionalByTicker(instEvents);
  const insiderByTicker = groupInsiderByTicker(insiderEvents);
  const tickers = [...instByTicker.keys()].filter((t) => insiderByTicker.has(t));
  const enrichment = await loadStockEnrichment(pool, tickers);
  const signals = buildSignals(instByTicker, insiderByTicker, enrichment);

  const sectors = [...new Set(signals.map((s) => s.sector).filter(Boolean))].sort() as string[];
  const institutions: DoubleSignalInstitutionOption[] = listTrackedInstitutions().map((f) => ({
    cik: f.cik,
    name: f.name,
  }));

  return {
    computedAt: new Date().toISOString(),
    windowDays,
    latest13fFilingDate,
    windowStart: isoDateDaysAgo(windowDays),
    windowEnd: todayIso(),
    summary: buildSummary(signals, instEvents, insiderEvents),
    sectors,
    institutions,
    signals,
  };
}

export async function computeDoubleSignalDetail(
  ticker: string,
  windowDays: DoubleSignalWindowDays,
  pool: pg.Pool = getPool()
): Promise<DoubleSignalDetailPayload | null> {
  const sym = String(ticker || "").trim().toUpperCase();
  if (!sym) return null;

  const [instEvents, insiderEvents] = await Promise.all([
    loadInstitutionalBuyEvents(windowDays, pool),
    loadInsiderBuyEvents(windowDays, pool),
  ]);

  const instByTicker = groupInstitutionalByTicker(instEvents);
  const insiderByTicker = groupInsiderByTicker(insiderEvents);
  const stockInst = instByTicker.get(sym) ?? [];
  const stockInsider = insiderByTicker.get(sym) ?? [];
  if (!stockInst.length || !stockInsider.length) return null;

  const enrichment = await loadStockEnrichment(pool, [sym]);
  const meta = enrichment.get(sym);
  const institutionIds = new Set(stockInst.map((e) => e.institutionId));
  const insiderNames = new Set(
    stockInsider.map((e) => String(e.insiderName || "").trim().toLowerCase()).filter(Boolean)
  );
  const totalInstitutionalValueUsd = stockInst.reduce((s, e) => s + (e.positionValueUsd ?? 0), 0);
  const totalInsiderPurchaseUsd = stockInsider.reduce(
    (s, e) => s + Math.abs(Number(e.transactionValue) || 0),
    0
  );

  return {
    ticker: sym,
    companyName: meta?.companyName ?? stockInst.find((e) => e.companyName)?.companyName ?? null,
    sector: meta?.sector ?? null,
    signalStrengthScore: computeSignalStrengthScore({
      institutionCount: institutionIds.size,
      insiderPurchaseCount: insiderNames.size,
      totalInstitutionalValueUsd,
      totalInsiderPurchaseUsd,
    }),
    institutionEvents: stockInst.sort(
      (a, b) => parseIsoDate(b.filingDate) - parseIsoDate(a.filingDate)
    ),
    insiderEvents: stockInsider.sort(
      (a, b) => parseIsoDate(b.transactionDate) - parseIsoDate(a.transactionDate)
    ),
    timeline: buildTimeline(stockInst, stockInsider),
  };
}
