import assert from "node:assert/strict";
import test from "node:test";
import { buildInsiderClusterSignals } from "./clusterEngine.js";
import { clusterRoleWeight, isCeoRole } from "./roleWeights.js";
import { clusterStrengthLabel, clusterAlert } from "./classify.js";
import { filterOutlierInsiderBuys } from "./outliers.js";
import { isClusterBuyingFlag } from "./thresholds.js";
import type { InsiderBuyRow } from "./types.js";

function buy( partial: Partial<InsiderBuyRow> & Pick<InsiderBuyRow, "ticker" | "insiderName">): InsiderBuyRow {
  return {
    insiderTitle: null,
    transactionDate: "2026-08-01",
    transactionValue: 10_000,
    shares: 1000,
    pricePerShare: 10,
    cik: "1",
    ...partial,
  };
}

test("cluster role weights match spec", () => {
  assert.equal(clusterRoleWeight("Chief Executive Officer"), 1.0);
  assert.equal(clusterRoleWeight("Chairman"), 0.9);
  assert.equal(clusterRoleWeight("CFO"), 0.85);
  assert.equal(clusterRoleWeight("President"), 0.8);
  assert.equal(clusterRoleWeight("COO"), 0.75);
  assert.equal(clusterRoleWeight("Director"), 0.5);
  assert.equal(isCeoRole("CEO"), true);
  assert.equal(isCeoRole("Interim CEO and CFO"), true);
});

test("executive cluster buying ranks higher than single buyer", () => {
  const rows: InsiderBuyRow[] = [
    buy({
      ticker: "CLUSTER",
      insiderName: "Alice CEO",
      insiderTitle: "Chief Executive Officer",
      transactionDate: "2026-05-01",
      transactionValue: 500_000,
      shares: 1000,
      pricePerShare: 500,
      cik: "0000000001",
    }),
    buy({
      ticker: "CLUSTER",
      insiderName: "Bob CFO",
      insiderTitle: "CFO",
      transactionDate: "2026-05-10",
      transactionValue: 300_000,
      shares: 800,
      pricePerShare: 375,
      cik: "0000000001",
    }),
    buy({
      ticker: "CLUSTER",
      insiderName: "Carol Director",
      insiderTitle: "Director",
      transactionDate: "2026-05-15",
      transactionValue: 100_000,
      shares: 500,
      pricePerShare: 200,
      cik: "0000000001",
    }),
    buy({
      ticker: "SOLO",
      insiderName: "Dave Officer",
      insiderTitle: "VP Sales",
      transactionDate: "2026-05-01",
      transactionValue: 50_000,
      shares: 200,
      pricePerShare: 250,
      cik: "0000000002",
    }),
  ];

  const signals = buildInsiderClusterSignals(rows, 60);
  const cluster = signals.find((s) => s.ticker === "CLUSTER");
  const solo = signals.find((s) => s.ticker === "SOLO");
  assert.ok(cluster && solo);
  assert.ok(cluster.insiderClusterScore > solo.insiderClusterScore);
  assert.equal(cluster.buyerCount, 3);
  assert.equal(cluster.ceoParticipation, true);
  assert.equal(clusterAlert(cluster.buyerCount, cluster.ceoParticipation, cluster.insiderClusterScore), true);
  assert.ok(cluster.insiderClusterScore >= 70);
});

test("multi-buyer CEO accumulation is not buried as no significant cluster", () => {
  // APCX-like: many small director buys + interim CEO buys (no peer tickers to inflate ranks).
  const rows: InsiderBuyRow[] = [
    buy({
      ticker: "APCX",
      insiderName: "LORD ALBERT L",
      insiderTitle: "Director",
      transactionDate: "2026-08-26",
      transactionValue: 7190,
      shares: 20_000,
      pricePerShare: 0.36,
    }),
    buy({
      ticker: "APCX",
      insiderName: "LORD ALBERT L",
      insiderTitle: "Director",
      transactionDate: "2026-08-20",
      transactionValue: 7248,
      shares: 20_000,
      pricePerShare: 0.36,
    }),
    buy({
      ticker: "APCX",
      insiderName: "Corrado Felipe Amilcar IV",
      insiderTitle: "Interim CEO and CFO",
      transactionDate: "2026-08-20",
      transactionValue: 1850,
      shares: 5000,
      pricePerShare: 0.37,
    }),
    buy({
      ticker: "APCX",
      insiderName: "Corrado Felipe Amilcar IV",
      insiderTitle: "Interim CEO and CFO",
      transactionDate: "2026-08-20",
      transactionValue: 1900,
      shares: 5000,
      pricePerShare: 0.38,
    }),
    // Bad Form 4 parse — should be excluded from totals/score.
    buy({
      ticker: "APCX",
      insiderName: "LORD ALBERT L",
      insiderTitle: "Director",
      transactionDate: "2026-08-03",
      transactionValue: 58_000_000,
      shares: 20_000,
      pricePerShare: 2900,
    }),
  ];

  const signals = buildInsiderClusterSignals(rows, 60);
  const apcx = signals.find((s) => s.ticker === "APCX");
  assert.ok(apcx);
  assert.equal(apcx.buyerCount, 2);
  assert.equal(apcx.ceoParticipation, true);
  assert.ok(apcx.totalBuyValue < 100_000, `expected cleaned value, got ${apcx.totalBuyValue}`);
  assert.ok(apcx.insiderClusterScore >= 50, `expected meaningful score, got ${apcx.insiderClusterScore}`);
  assert.notEqual(apcx.clusterStrengthLabel, "No Significant Cluster");
});

test("outlier filter drops absurd penny-stock prints", () => {
  const cleaned = filterOutlierInsiderBuys([
    buy({ ticker: "X", insiderName: "A", pricePerShare: 0.35, transactionValue: 7000, shares: 20_000 }),
    buy({ ticker: "X", insiderName: "A", pricePerShare: 0.36, transactionValue: 7200, shares: 20_000 }),
    buy({ ticker: "X", insiderName: "A", pricePerShare: 0.37, transactionValue: 7400, shares: 20_000 }),
    buy({ ticker: "X", insiderName: "A", pricePerShare: 2900, transactionValue: 58_000_000, shares: 20_000 }),
  ]);
  assert.equal(cleaned.length, 3);
  assert.ok(cleaned.every((r) => Number(r.pricePerShare) < 1));
});

test("cluster alert requires 3 buyers plus CEO or high score", () => {
  assert.equal(clusterAlert(2, true, 99), false);
  assert.equal(clusterAlert(3, true, 40), true);
  assert.equal(clusterAlert(3, false, 79), false);
  assert.equal(clusterAlert(3, false, 80), true);
});

test("cluster strength labels", () => {
  assert.equal(clusterStrengthLabel(90), "Executive Cluster Buying");
  assert.equal(clusterStrengthLabel(75), "Strong Insider Accumulation");
  assert.equal(clusterStrengthLabel(55), "Moderate Insider Buying");
  assert.equal(clusterStrengthLabel(40), "Limited Insider Activity");
  assert.equal(clusterStrengthLabel(10), "No Significant Cluster");
});

test("cluster buying flag follows alert only", () => {
  assert.equal(isClusterBuyingFlag({ clusterAlert: true }), true);
  assert.equal(isClusterBuyingFlag({ clusterAlert: false }), false);
  assert.equal(isClusterBuyingFlag(null), false);
});

test("sell transactions are excluded from engine input", () => {
  const signals = buildInsiderClusterSignals(
    [
      buy({
        ticker: "X",
        insiderName: "Buyer",
        insiderTitle: "Director",
        transactionDate: "2026-05-01",
        transactionValue: 10_000,
        shares: 100,
        pricePerShare: 100,
        cik: "1",
      }),
    ],
    60
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0].buyerCount, 1);
});
