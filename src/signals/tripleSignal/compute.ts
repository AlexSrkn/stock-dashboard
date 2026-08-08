import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getInstitutionActivity, listTrackedInstitutions } from "../../institution/institutionAnalytics.js";
import { politicianKey as slugPoliticianKey } from "../../politicians/politicianKey.js";
import { normalizeTicker } from "../../politicians/byTicker.js";
import { readPoliticiansRecent } from "../../politicians/recent.js";
import {
  SELECT_INSIDER_BUYS_IN_WINDOW_SQL,
  SELECT_LATEST_13F_FILING_DATE_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
  trackedInstitutionCiks,
} from "../doubleSignal/queries.js";
import { computeTripleSignalStrengthScore } from "./score.js";
import type {
  InstitutionalBuyEvent,
  InsiderBuyEvent,
  PoliticianBuyEvent,
  TripleSignalDetailPayload,
  TripleSignalInstitutionOption,
  TripleSignalPayload,
  TripleSignalRow,
  TripleSignalSummary,
  TripleSignalTimelineEvent,
  TripleSignalWindowDays,
} from "./types.js";

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

function estimatedPurchaseUsd(amountMin: number | null, amountMax: number | null): number {
  const min = Number(amountMin);
  const max = Number(amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) return (min + max) / 2;
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

function resolvePoliticianTicker(ticker: string | null, assetName: string | null): string | null {
  const direct = normalizeTicker(ticker || "");
  if (direct) return direct;
  const paren = String(assetName || "").match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
  const fromName = normalizeTicker(paren?.[1] || "");
  return fromName || null;
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
  windowDays: TripleSignalWindowDays,
  pool: pg.Pool
): Promise<InsiderBuyEvent[]> {
  const res = await pool.query<InsiderBuyEvent>(SELECT_INSIDER_BUYS_IN_WINDOW_SQL, [windowDays]);
  return res.rows.filter((r) => r.ticker && r.insiderName);
}

async function loadInstitutionalBuyEvents(
  windowDays: TripleSignalWindowDays,
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

function loadPoliticianBuyEvents(windowDays: TripleSignalWindowDays): PoliticianBuyEvent[] {
  const payload = readPoliticiansRecent();
  if (!payload) return [];

  const windowStartMs = parseIsoDate(isoDateDaysAgo(windowDays));
  const events: PoliticianBuyEvent[] = [];

  for (const bundle of [...payload.house, ...payload.senate]) {
    const key = bundle.politicianKey || slugPoliticianKey(bundle.politicianName);
    const party = bundle.party ?? null;
    for (const trade of bundle.trades || []) {
      if (trade.transactionCategory !== "buy") continue;
      const ticker = resolvePoliticianTicker(trade.ticker, trade.assetName);
      if (!ticker || !/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) continue;

      const dateRaw =
        trade.transactionDate || trade.notificationDate || trade.filingDate || bundle.filingDate;
      const dateMs = parseIsoDate(dateRaw);
      if (!dateMs || dateMs < windowStartMs) continue;

      const iso =
        String(dateRaw || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ||
        new Date(dateMs).toISOString().slice(0, 10);

      events.push({
        politicianKey: key,
        politicianName: bundle.politicianName,
        chamber: bundle.chamber,
        party: trade.party ?? party,
        state: trade.state
          ? String(trade.state).toUpperCase()
          : bundle.state
            ? String(bundle.state).toUpperCase()
            : null,
        ticker,
        companyName: trade.assetName ? String(trade.assetName).trim() || null : null,
        transactionDate: iso,
        disclosureDate: trade.notificationDate || trade.filingDate || bundle.filingDate || null,
        estimatedPurchaseUsd: estimatedPurchaseUsd(trade.amountMin, trade.amountMax),
        filingId: trade.filingId || bundle.filingId || null,
        sourceUrl: trade.sourceUrl || bundle.sourceUrl || null,
      });
    }
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
    const ticker = event.ticker || cusipToTicker.get(event.cusip) || null;
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

function groupPoliticianByTicker(
  events: PoliticianBuyEvent[]
): Map<string, PoliticianBuyEvent[]> {
  const byTicker = new Map<string, PoliticianBuyEvent[]>();
  for (const event of events) {
    const ticker = String(event.ticker || "").trim().toUpperCase();
    if (!ticker) continue;
    const list = byTicker.get(ticker) ?? [];
    list.push(event);
    byTicker.set(ticker, list);
  }
  return byTicker;
}

function insiderRoleFlags(events: InsiderBuyEvent[]): TripleSignalRow["insiderRoles"] {
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

function buildSummary(
  signals: TripleSignalRow[],
  instEvents: InstitutionalBuyEvent[],
  insiderEvents: InsiderBuyEvent[],
  politicianEvents: PoliticianBuyEvent[]
): TripleSignalSummary {
  return {
    totalTripleSignals: signals.length,
    uniqueStocks: signals.length,
    institutionsInvolved: new Set(instEvents.map((e) => e.institutionId)).size,
    insiderPurchases: insiderEvents.length,
    politicianPurchases: politicianEvents.length,
  };
}

function buildSignals(
  instByTicker: Map<string, InstitutionalBuyEvent[]>,
  insiderByTicker: Map<string, InsiderBuyEvent[]>,
  politicianByTicker: Map<string, PoliticianBuyEvent[]>,
  enrichment: Map<string, { companyName: string | null; sector: string | null }>
): TripleSignalRow[] {
  const signals: TripleSignalRow[] = [];

  for (const [ticker, instEvents] of instByTicker) {
    const insiderEvents = insiderByTicker.get(ticker);
    const politicianEvents = politicianByTicker.get(ticker);
    if (!insiderEvents?.length || !politicianEvents?.length) continue;

    const institutionIds = new Set(instEvents.map((e) => e.institutionId));
    const insiderNames = new Set(
      insiderEvents.map((e) => String(e.insiderName || "").trim().toLowerCase()).filter(Boolean)
    );
    const politicianKeys = new Set(politicianEvents.map((e) => e.politicianKey).filter(Boolean));

    const instValues = instEvents
      .map((e) => e.positionValueUsd ?? 0)
      .filter((v) => Number.isFinite(v) && v > 0);
    const insiderValues = insiderEvents
      .map((e) => Math.abs(Number(e.transactionValue) || 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const polValues = politicianEvents
      .map((e) => Number(e.estimatedPurchaseUsd) || 0)
      .filter((v) => Number.isFinite(v) && v > 0);

    const totalInstitutionalValueUsd = instValues.reduce((s, v) => s + v, 0);
    const totalInsiderPurchaseUsd = insiderValues.reduce((s, v) => s + v, 0);
    const totalPoliticianPurchaseUsd = polValues.reduce((s, v) => s + v, 0);

    const meta = enrichment.get(ticker);
    const companyName =
      meta?.companyName ??
      instEvents.find((e) => e.companyName)?.companyName ??
      politicianEvents.find((e) => e.companyName)?.companyName ??
      null;

    signals.push({
      ticker,
      companyName,
      sector: meta?.sector ?? null,
      cusip: instEvents.find((e) => e.cusip)?.cusip ?? null,
      institutionCount: institutionIds.size,
      institutionIds: [...institutionIds],
      insiderPurchaseCount: insiderNames.size,
      politicianPurchaseCount: politicianKeys.size,
      insiderRoles: insiderRoleFlags(insiderEvents),
      largestInstitutionalPositionUsd: instValues.length ? Math.max(...instValues) : null,
      largestInsiderPurchaseUsd: insiderValues.length ? Math.max(...insiderValues) : 0,
      largestPoliticianPurchaseUsd: polValues.length ? Math.max(...polValues) : 0,
      latestInstitutionalFilingDate:
        instEvents
          .slice()
          .sort((a, b) => parseIsoDate(b.filingDate) - parseIsoDate(a.filingDate))[0]
          ?.filingDate ?? null,
      latestInsiderPurchaseDate:
        insiderEvents
          .slice()
          .sort((a, b) => parseIsoDate(b.transactionDate) - parseIsoDate(a.transactionDate))[0]
          ?.transactionDate ?? null,
      latestPoliticianPurchaseDate:
        politicianEvents
          .slice()
          .sort((a, b) => parseIsoDate(b.transactionDate) - parseIsoDate(a.transactionDate))[0]
          ?.transactionDate ?? null,
      totalInstitutionalValueUsd: Math.round(totalInstitutionalValueUsd),
      totalInsiderPurchaseUsd: Math.round(totalInsiderPurchaseUsd),
      totalPoliticianPurchaseUsd: Math.round(totalPoliticianPurchaseUsd),
      signalStrengthScore: computeTripleSignalStrengthScore({
        institutionCount: institutionIds.size,
        insiderPurchaseCount: insiderNames.size,
        politicianPurchaseCount: politicianKeys.size,
        totalInstitutionalValueUsd,
        totalInsiderPurchaseUsd,
        totalPoliticianPurchaseUsd,
      }),
    });
  }

  return signals.sort(
    (a, b) =>
      b.signalStrengthScore - a.signalStrengthScore ||
      b.institutionCount - a.institutionCount ||
      b.politicianPurchaseCount - a.politicianPurchaseCount ||
      b.insiderPurchaseCount - a.insiderPurchaseCount
  );
}

export function buildTripleTimeline(
  instEvents: InstitutionalBuyEvent[],
  insiderEvents: InsiderBuyEvent[],
  politicianEvents: PoliticianBuyEvent[]
): TripleSignalTimelineEvent[] {
  const timeline: TripleSignalTimelineEvent[] = [];

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

  for (const e of politicianEvents) {
    const date = e.transactionDate ?? "";
    if (!date) continue;
    const chamber = e.chamber === "senate" ? "Senate" : "House";
    const party = e.party ? ` · ${e.party}` : "";
    timeline.push({
      date,
      type: "politician",
      label: e.politicianName,
      detail: `${chamber}${party}`,
      valueUsd: e.estimatedPurchaseUsd || null,
    });
  }

  return timeline.sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
}

export async function computeTripleSignals(
  windowDays: TripleSignalWindowDays,
  pool: pg.Pool = getPool()
): Promise<TripleSignalPayload> {
  const [latest13fFilingDate, instEvents, insiderEvents] = await Promise.all([
    loadLatest13fFilingDate(pool),
    loadInstitutionalBuyEvents(windowDays, pool),
    loadInsiderBuyEvents(windowDays, pool),
  ]);
  const politicianEvents = loadPoliticianBuyEvents(windowDays);

  const instByTicker = groupInstitutionalByTicker(instEvents);
  const insiderByTicker = groupInsiderByTicker(insiderEvents);
  const politicianByTicker = groupPoliticianByTicker(politicianEvents);
  const tickers = [...instByTicker.keys()].filter(
    (t) => insiderByTicker.has(t) && politicianByTicker.has(t)
  );
  const enrichment = await loadStockEnrichment(pool, tickers);
  const signals = buildSignals(instByTicker, insiderByTicker, politicianByTicker, enrichment);

  const sectors = [...new Set(signals.map((s) => s.sector).filter(Boolean))].sort() as string[];
  const institutions: TripleSignalInstitutionOption[] = listTrackedInstitutions().map((f) => ({
    cik: f.cik,
    name: f.name,
  }));

  return {
    computedAt: new Date().toISOString(),
    windowDays,
    latest13fFilingDate,
    windowStart: isoDateDaysAgo(windowDays),
    windowEnd: todayIso(),
    summary: buildSummary(signals, instEvents, insiderEvents, politicianEvents),
    sectors,
    institutions,
    signals,
  };
}

export async function computeTripleSignalDetail(
  ticker: string,
  windowDays: TripleSignalWindowDays,
  pool: pg.Pool = getPool()
): Promise<TripleSignalDetailPayload | null> {
  const sym = String(ticker || "").trim().toUpperCase();
  if (!sym) return null;

  const [instEvents, insiderEvents] = await Promise.all([
    loadInstitutionalBuyEvents(windowDays, pool),
    loadInsiderBuyEvents(windowDays, pool),
  ]);
  const politicianEvents = loadPoliticianBuyEvents(windowDays);

  const stockInst = groupInstitutionalByTicker(instEvents).get(sym) ?? [];
  const stockInsider = groupInsiderByTicker(insiderEvents).get(sym) ?? [];
  const stockPol = groupPoliticianByTicker(politicianEvents).get(sym) ?? [];
  if (!stockInst.length || !stockInsider.length || !stockPol.length) return null;

  const enrichment = await loadStockEnrichment(pool, [sym]);
  const meta = enrichment.get(sym);
  const institutionIds = new Set(stockInst.map((e) => e.institutionId));
  const insiderNames = new Set(
    stockInsider.map((e) => String(e.insiderName || "").trim().toLowerCase()).filter(Boolean)
  );
  const politicianKeys = new Set(stockPol.map((e) => e.politicianKey));
  const totalInstitutionalValueUsd = stockInst.reduce((s, e) => s + (e.positionValueUsd ?? 0), 0);
  const totalInsiderPurchaseUsd = stockInsider.reduce(
    (s, e) => s + Math.abs(Number(e.transactionValue) || 0),
    0
  );
  const totalPoliticianPurchaseUsd = stockPol.reduce(
    (s, e) => s + (Number(e.estimatedPurchaseUsd) || 0),
    0
  );

  return {
    ticker: sym,
    companyName: meta?.companyName ?? stockInst.find((e) => e.companyName)?.companyName ?? null,
    sector: meta?.sector ?? null,
    signalStrengthScore: computeTripleSignalStrengthScore({
      institutionCount: institutionIds.size,
      insiderPurchaseCount: insiderNames.size,
      politicianPurchaseCount: politicianKeys.size,
      totalInstitutionalValueUsd,
      totalInsiderPurchaseUsd,
      totalPoliticianPurchaseUsd,
    }),
    institutionEvents: stockInst.sort(
      (a, b) => parseIsoDate(b.filingDate) - parseIsoDate(a.filingDate)
    ),
    insiderEvents: stockInsider.sort(
      (a, b) => parseIsoDate(b.transactionDate) - parseIsoDate(a.transactionDate)
    ),
    politicianEvents: stockPol.sort(
      (a, b) => parseIsoDate(b.transactionDate) - parseIsoDate(a.transactionDate)
    ),
    timeline: buildTripleTimeline(stockInst, stockInsider, stockPol),
  };
}
