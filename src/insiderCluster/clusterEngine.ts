import { clusterAlert, clusterStrengthLabel } from "./classify.js";
import {
  absoluteBuyValueScore,
  absoluteBuyerCountScore,
  absoluteDensityScore,
  absoluteRoleWeightScore,
  capScore,
} from "./normalize.js";
import { filterOutlierInsiderBuys } from "./outliers.js";
import { clusterRoleWeight, isCeoRole } from "./roleWeights.js";
import { buildClusterSignal } from "./signals.js";
import type { ClusterLookbackDays, InsiderBuyRow, InsiderClusterSignal } from "./types.js";

interface BuyerState {
  name: string;
  title: string | null;
  weight: number;
  isCeo: boolean;
}

interface TickerAccumulator {
  buyers: Map<string, BuyerState>;
  totalBuyValue: number;
  minDateMs: number | null;
  maxDateMs: number | null;
}

export interface InsiderClusterDraft extends InsiderClusterSignal {
  buyerRoles: Map<string, string | null>;
  clusterDensityRaw: number;
}

function buyerKey(name: string): string {
  return String(name || "").trim().toLowerCase();
}

function parseDateMs(date: string | null): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function daysBetween(minMs: number | null, maxMs: number | null): number {
  if (minMs == null || maxMs == null) return 0;
  return Math.max(0, Math.round((maxMs - minMs) / 86_400_000));
}

function aggregateByTicker(rows: InsiderBuyRow[]): Map<string, TickerAccumulator> {
  const byTicker = new Map<string, TickerAccumulator>();

  for (const row of rows) {
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!ticker) continue;

    let acc = byTicker.get(ticker);
    if (!acc) {
      acc = { buyers: new Map(), totalBuyValue: 0, minDateMs: null, maxDateMs: null };
      byTicker.set(ticker, acc);
    }

    const key = buyerKey(row.insiderName);
    const weight = clusterRoleWeight(row.insiderTitle);
    const existing = acc.buyers.get(key);
    if (!existing || weight > existing.weight) {
      acc.buyers.set(key, {
        name: row.insiderName,
        title: row.insiderTitle,
        weight,
        isCeo: isCeoRole(row.insiderTitle),
      });
    }

    const value = Math.abs(Number(row.transactionValue) || 0);
    if (Number.isFinite(value) && value > 0) acc.totalBuyValue += value;

    const dateMs = parseDateMs(row.transactionDate);
    if (dateMs != null) {
      acc.minDateMs = acc.minDateMs == null ? dateMs : Math.min(acc.minDateMs, dateMs);
      acc.maxDateMs = acc.maxDateMs == null ? dateMs : Math.max(acc.maxDateMs, dateMs);
    }
  }

  return byTicker;
}

function buildDrafts(
  byTicker: Map<string, TickerAccumulator>,
  lookbackDays: ClusterLookbackDays
): Map<string, InsiderClusterDraft> {
  const drafts = new Map<string, InsiderClusterDraft>();

  for (const [ticker, acc] of byTicker) {
    const buyerCount = acc.buyers.size;
    if (buyerCount === 0) continue;

    let roleWeightScore = 0;
    let ceoParticipation = false;
    const buyerRoles = new Map<string, string | null>();
    for (const [, buyer] of acc.buyers) {
      roleWeightScore += buyer.weight;
      if (buyer.isCeo) ceoParticipation = true;
      buyerRoles.set(buyerKey(buyer.name), buyer.title);
    }

    const spanDays = daysBetween(acc.minDateMs, acc.maxDateMs);
    const clusterDensityRaw = buyerCount / Math.max(spanDays, 1);

    // Absolute tiers — not min-max vs other tickers (that buried real buying like APCX).
    const normalizedBuyerCount = absoluteBuyerCountScore(buyerCount);
    const roleWeightScoreNormalized = absoluteRoleWeightScore(roleWeightScore);
    const buyValueScore = absoluteBuyValueScore(acc.totalBuyValue);
    const clusterDensityScore = absoluteDensityScore(buyerCount, spanDays);
    const ceoBonus = ceoParticipation ? 20 : 0;

    const baseScore =
      0.4 * normalizedBuyerCount +
      0.25 * roleWeightScoreNormalized +
      0.2 * buyValueScore +
      0.15 * clusterDensityScore;

    const insiderClusterScore = capScore(baseScore + ceoBonus);

    const partial: InsiderClusterDraft = {
      ticker,
      insiderClusterScore,
      clusterStrengthLabel: clusterStrengthLabel(insiderClusterScore),
      buyerCount,
      ceoParticipation,
      totalBuyValue: acc.totalBuyValue,
      roleWeightScore: Math.round(roleWeightScore * 10_000) / 10_000,
      clusterDensityScore,
      clusterSignal: "",
      clusterAlert: clusterAlert(buyerCount, ceoParticipation, insiderClusterScore),
      lookbackDays,
      daysBetweenFirstAndLastBuy: spanDays,
      supportingMetrics: {
        normalizedBuyerCount,
        roleWeightScoreNormalized,
        buyValueScore,
        clusterDensityRaw: Math.round(clusterDensityRaw * 10_000) / 10_000,
        ceoBonus,
      },
      buyerRoles,
      clusterDensityRaw,
    };

    partial.clusterSignal = buildClusterSignal(partial, lookbackDays);
    drafts.set(ticker, partial);
  }

  return drafts;
}

export function buildInsiderClusterSignals(
  rows: InsiderBuyRow[],
  lookbackDays: ClusterLookbackDays
): InsiderClusterSignal[] {
  const cleaned = filterOutlierInsiderBuys(rows);
  const byTicker = aggregateByTicker(cleaned);
  const drafts = buildDrafts(byTicker, lookbackDays);

  return [...drafts.values()]
    .map(({ buyerRoles: _buyerRoles, clusterDensityRaw: _raw, ...signal }) => signal)
    .sort((a, b) => b.insiderClusterScore - a.insiderClusterScore);
}
