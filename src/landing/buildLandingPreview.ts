import { getRecentInsiderTransactions } from "../insider/insiderAnalytics.js";
import { readPoliticiansRecent } from "../politicians/recent.js";
import { getCachedConflictSignals } from "../signals/conflictSignals/cache.js";
import { getCachedDoubleSignal } from "../signals/doubleSignal/cache.js";
import { DEFAULT_DOUBLE_SIGNAL_WINDOW } from "../signals/doubleSignal/types.js";
import { getCachedTripleSignal } from "../signals/tripleSignal/cache.js";
import { DEFAULT_TRIPLE_SIGNAL_WINDOW } from "../signals/tripleSignal/types.js";
import { getCachedTopInstitutionNewEntries } from "../signals/topInstitutionNewEntriesCache.js";
import { getCachedInstitutionalAccumulation } from "../stocks/institutionalAccumulationCache.js";
import { readSectorDiskCache } from "../stocks/sectorDiskCache.js";
import type { SectorAccumulationPayload } from "../stocks/sectorAccumulation.js";

const PREVIEW_LIMIT = 4;

export interface LandingPreviewRow {
  primary: string;
  secondary: string;
  meta: string;
  side?: "buy" | "sell" | "neutral";
  provenance: string;
}

export interface LandingPreviewLane {
  id: "institutional" | "insider" | "congress" | "signals" | "sector";
  label: string;
  provenance: string;
  rows: LandingPreviewRow[];
  emptyHint: string;
}

export interface LandingSignalExample {
  kind: "triple" | "double";
  ticker: string;
  companyName: string | null;
  summary: string;
  windowDays: number;
  provenance: string;
}

export interface LandingPreviewPayload {
  computedAt: string;
  disclaimer: string;
  marketContextNote: string;
  lanes: LandingPreviewLane[];
  signalExamples: LandingSignalExample[];
  signalSummary: {
    doubleCount: number | null;
    tripleCount: number | null;
    conflictCount: number | null;
    doubleWindowDays: number;
    tripleWindowDays: number;
  };
  quarters: {
    institutional: string | null;
    sector: string | null;
  };
}

function sideFromAcq(code: string | null | undefined): "buy" | "sell" | "neutral" {
  const c = String(code || "").toUpperCase();
  if (c === "A" || c === "P") return "buy";
  if (c === "D" || c === "S") return "sell";
  return "neutral";
}

function formatCompactUsd(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatShares(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M sh`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K sh`;
  return `${sign}${Math.round(abs)} sh`;
}

function buildInstitutionalLane(): {
  lane: LandingPreviewLane;
  quarter: string | null;
} {
  const provenance = "SEC 13F";
  const empty: LandingPreviewLane = {
    id: "institutional",
    label: "Institutional activity",
    provenance,
    rows: [],
    emptyHint: "13F preview loads after institutional caches are warm.",
  };

  const newEntries = getCachedTopInstitutionNewEntries();
  if (newEntries?.entries?.length) {
    const rows = newEntries.entries.slice(0, PREVIEW_LIMIT).map((e) => {
      const value = formatCompactUsd(e.currentValueUsd);
      return {
        primary: e.ticker,
        secondary: e.institutionName,
        meta: [value, e.quarter ? `New · ${e.quarter}` : "New position"].filter(Boolean).join(" · "),
        side: "buy" as const,
        provenance,
      };
    });
    return {
      lane: { ...empty, rows },
      quarter: newEntries.asOfQuarter,
    };
  }

  const accum = getCachedInstitutionalAccumulation(PREVIEW_LIMIT);
  if (accum?.stocks?.length) {
    const rows = accum.stocks.slice(0, PREVIEW_LIMIT).map((s) => ({
      primary: s.ticker,
      secondary: `${s.institutionCount} institutions adding`,
      meta: [formatShares(s.sharesBought), accum.currentQuarter].filter(Boolean).join(" · "),
      side: "buy" as const,
      provenance,
    }));
    return {
      lane: { ...empty, rows },
      quarter: accum.currentQuarter,
    };
  }

  return { lane: empty, quarter: null };
}

async function buildInsiderLane(): Promise<LandingPreviewLane> {
  const provenance = "Form 4";
  const empty: LandingPreviewLane = {
    id: "insider",
    label: "Insider activity",
    provenance,
    rows: [],
    emptyHint: "Recent Form 4 purchases appear here when available.",
  };
  try {
    const payload = await getRecentInsiderTransactions({
      limit: 24,
      signal: "high",
      codes: ["P"],
    });
    const rows = payload.transactions
      .filter((t) => t.ticker)
      .slice(0, PREVIEW_LIMIT)
      .map((t) => {
        const value = formatCompactUsd(t.transactionValue);
        const role = (t.insiderTitle || "Insider").trim();
        return {
          primary: String(t.ticker).toUpperCase(),
          secondary: `${t.insiderName}${role ? ` · ${role}` : ""}`,
          meta: [value, t.transactionDate || t.filingDate].filter(Boolean).join(" · "),
          side: sideFromAcq(t.acquisitionDisposition || t.transactionCode),
          provenance,
        };
      });
    return { ...empty, rows };
  } catch {
    return empty;
  }
}

function buildCongressLane(): LandingPreviewLane {
  const provenance = "Congressional disclosure";
  const empty: LandingPreviewLane = {
    id: "congress",
    label: "Congress disclosures",
    provenance,
    rows: [],
    emptyHint: "House and Senate PTR trades appear after politician data is fetched.",
  };
  const recent = readPoliticiansRecent();
  if (!recent) return empty;

  const trades = [...(recent.house || []), ...(recent.senate || [])]
    .flatMap((bundle) => bundle.trades || [])
    .filter((t) => t.ticker && (t.transactionCategory === "buy" || t.transactionCategory === "sell"))
    .sort((a, b) => {
      const da = a.transactionDate || a.filingDate || "";
      const db = b.transactionDate || b.filingDate || "";
      return db.localeCompare(da);
    });

  const rows = trades.slice(0, PREVIEW_LIMIT).map((t) => ({
    primary: String(t.ticker).toUpperCase(),
    secondary: `${t.politicianName} · ${t.chamber === "senate" ? "Senate" : "House"}`,
    meta: [t.amountRange, t.transactionDate || t.filingDate].filter(Boolean).join(" · "),
    side: (t.transactionCategory === "sell" ? "sell" : "buy") as "buy" | "sell",
    provenance,
  }));

  return { ...empty, rows };
}

function buildSignalsLane(): {
  lane: LandingPreviewLane;
  examples: LandingSignalExample[];
  summary: LandingPreviewPayload["signalSummary"];
} {
  const provenance = "Public filing data";
  const doubleWindow = DEFAULT_DOUBLE_SIGNAL_WINDOW;
  const tripleWindow = DEFAULT_TRIPLE_SIGNAL_WINDOW;
  const double = getCachedDoubleSignal(doubleWindow);
  const triple = getCachedTripleSignal(tripleWindow);
  const conflict = getCachedConflictSignals();

  const examples: LandingSignalExample[] = [];
  for (const row of (triple?.signals || []).slice(0, 2)) {
    examples.push({
      kind: "triple",
      ticker: row.ticker,
      companyName: row.companyName,
      summary: `${row.institutionCount} institutions · ${row.insiderPurchaseCount} Form 4 buys · ${row.politicianPurchaseCount} Congress buys`,
      windowDays: tripleWindow,
      provenance,
    });
  }
  for (const row of (double?.signals || []).slice(0, 2)) {
    if (examples.some((e) => e.ticker === row.ticker)) continue;
    examples.push({
      kind: "double",
      ticker: row.ticker,
      companyName: row.companyName,
      summary: `${row.institutionCount} institutions · ${row.insiderPurchaseCount} Form 4 buys`,
      windowDays: doubleWindow,
      provenance,
    });
    if (examples.length >= 3) break;
  }

  const rows: LandingPreviewRow[] = examples.slice(0, PREVIEW_LIMIT).map((e) => ({
    primary: e.ticker,
    secondary: e.kind === "triple" ? "Triple Signal" : "Double Signal",
    meta: `${e.windowDays}d window · ${e.summary}`,
    side: "buy",
    provenance,
  }));

  return {
    lane: {
      id: "signals",
      label: "Signals",
      provenance,
      rows,
      emptyHint: "Signal screens appear after signal caches are warm.",
    },
    examples,
    summary: {
      doubleCount: double?.signals?.length ?? null,
      tripleCount: triple?.signals?.length ?? null,
      conflictCount: conflict?.signals?.length ?? null,
      doubleWindowDays: doubleWindow,
      tripleWindowDays: tripleWindow,
    },
  };
}

function buildSectorLane(): {
  lane: LandingPreviewLane;
  quarter: string | null;
} {
  const provenance = "SEC 13F";
  const empty: LandingPreviewLane = {
    id: "sector",
    label: "Sectors",
    provenance,
    rows: [],
    emptyHint: "Sector accumulation appears after sector caches are warm.",
  };

  const disk = readSectorDiskCache<{
    sectors: SectorAccumulationPayload;
  }>("accumulation-pair", 1);
  const sectors = disk?.sectors?.sectors || [];
  if (!sectors.length) return { lane: empty, quarter: disk?.sectors?.currentQuarter || null };

  const ranked = [...sectors]
    .filter((s) => Number.isFinite(s.netValueChangeUsd))
    .sort((a, b) => Math.abs(b.netValueChangeUsd) - Math.abs(a.netValueChangeUsd))
    .slice(0, PREVIEW_LIMIT);

  const rows = ranked.map((s) => {
    const net = formatCompactUsd(s.netValueChangeUsd);
    return {
      primary: s.sector,
      secondary: `${s.institutionsBuying} institutions buying`,
      meta: [net ? `Net ${net}` : null, disk?.sectors?.currentQuarter].filter(Boolean).join(" · "),
      side: (s.netValueChangeUsd >= 0 ? "buy" : "sell") as "buy" | "sell",
      provenance,
    };
  });

  return {
    lane: { ...empty, rows },
    quarter: disk?.sectors?.currentQuarter || null,
  };
}

export async function buildLandingPreview(): Promise<LandingPreviewPayload> {
  const institutional = buildInstitutionalLane();
  const insider = await buildInsiderLane();
  const congress = buildCongressLane();
  const signals = buildSignalsLane();
  const sector = buildSectorLane();

  return {
    computedAt: new Date().toISOString(),
    disclaimer:
      "Preview rows are drawn from public filings and InvestAtlant research caches. Not investment advice.",
    marketContextNote:
      "Market prices and charts are secondary context in the workspace (TradingView).",
    lanes: [institutional.lane, insider, congress, signals.lane, sector.lane],
    signalExamples: signals.examples,
    signalSummary: signals.summary,
    quarters: {
      institutional: institutional.quarter,
      sector: sector.quarter,
    },
  };
}
