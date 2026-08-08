import { clusterAlert, clusterStrengthLabel } from "./classify.js";
import { minMaxTo100, capScore } from "./normalize.js";
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
  const buyerCountMap = new Map<string, number>();
  const roleWeightMap = new Map<string, number>();
  const buyValueMap = new Map<string, number>();
  const densityMap = new Map<string, number>();

  const rawByTicker = new Map<
    string,
    {
      buyerCount: number;
      roleWeightScore: number;
      totalBuyValue: number;
      clusterDensityRaw: number;
      ceoParticipation: boolean;
      daysBetween: number;
      buyerRoles: Map<string, string | null>;
    }
  >();

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

    buyerCountMap.set(ticker, buyerCount);
    roleWeightMap.set(ticker, roleWeightScore);
    buyValueMap.set(ticker, acc.totalBuyValue);
    densityMap.set(ticker, clusterDensityRaw);

    rawByTicker.set(ticker, {
      buyerCount,
      roleWeightScore,
      totalBuyValue: acc.totalBuyValue,
      clusterDensityRaw,
      ceoParticipation,
      daysBetween: spanDays,
      buyerRoles,
    });
  }

  const normBuyer = minMaxTo100(buyerCountMap);
  const normRole = minMaxTo100(roleWeightMap);
  const normValue = minMaxTo100(buyValueMap);
  const normDensity = minMaxTo100(densityMap);

  const drafts = new Map<string, InsiderClusterDraft>();

  for (const [ticker, raw] of rawByTicker) {
    const normalizedBuyerCount = normBuyer.get(ticker) ?? 0;
    const roleWeightScoreNormalized = normRole.get(ticker) ?? 0;
    const buyValueScore = normValue.get(ticker) ?? 0;
    const clusterDensityScore = normDensity.get(ticker) ?? 0;
    const ceoBonus = raw.ceoParticipation ? 25 : 0;

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
      buyerCount: raw.buyerCount,
      ceoParticipation: raw.ceoParticipation,
      totalBuyValue: raw.totalBuyValue,
      roleWeightScore: Math.round(raw.roleWeightScore * 10_000) / 10_000,
      clusterDensityScore,
      clusterSignal: "",
      clusterAlert: clusterAlert(raw.buyerCount, raw.ceoParticipation, insiderClusterScore),
      lookbackDays,
      daysBetweenFirstAndLastBuy: raw.daysBetween,
      supportingMetrics: {
        normalizedBuyerCount,
        roleWeightScoreNormalized,
        buyValueScore,
        clusterDensityRaw: Math.round(raw.clusterDensityRaw * 10_000) / 10_000,
        ceoBonus,
      },
      buyerRoles: raw.buyerRoles,
      clusterDensityRaw: raw.clusterDensityRaw,
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
  const byTicker = aggregateByTicker(rows);
  const drafts = buildDrafts(byTicker, lookbackDays);

  return [...drafts.values()]
    .map(({ buyerRoles: _buyerRoles, clusterDensityRaw: _raw, ...signal }) => signal)
    .sort((a, b) => b.insiderClusterScore - a.insiderClusterScore);
}
