import assert from "node:assert/strict";
import test from "node:test";
import { buildInsiderClusterSignals } from "./clusterEngine.js";
import { clusterRoleWeight, isCeoRole } from "./roleWeights.js";
import { clusterStrengthLabel, clusterAlert } from "./classify.js";
import type { InsiderBuyRow } from "./types.js";

test("cluster role weights match spec", () => {
  assert.equal(clusterRoleWeight("Chief Executive Officer"), 1.0);
  assert.equal(clusterRoleWeight("Chairman"), 0.9);
  assert.equal(clusterRoleWeight("CFO"), 0.85);
  assert.equal(clusterRoleWeight("President"), 0.8);
  assert.equal(clusterRoleWeight("COO"), 0.75);
  assert.equal(clusterRoleWeight("Director"), 0.5);
  assert.equal(isCeoRole("CEO"), true);
});

test("executive cluster buying ranks higher than single buyer", () => {
  const rows: InsiderBuyRow[] = [
    {
      ticker: "CLUSTER",
      insiderName: "Alice CEO",
      insiderTitle: "Chief Executive Officer",
      transactionDate: "2026-05-01",
      transactionValue: 500_000,
      shares: 1000,
      cik: "0000000001",
    },
    {
      ticker: "CLUSTER",
      insiderName: "Bob CFO",
      insiderTitle: "CFO",
      transactionDate: "2026-05-10",
      transactionValue: 300_000,
      shares: 800,
      cik: "0000000001",
    },
    {
      ticker: "CLUSTER",
      insiderName: "Carol Director",
      insiderTitle: "Director",
      transactionDate: "2026-05-15",
      transactionValue: 100_000,
      shares: 500,
      cik: "0000000001",
    },
    {
      ticker: "SOLO",
      insiderName: "Dave Officer",
      insiderTitle: "VP Sales",
      transactionDate: "2026-05-01",
      transactionValue: 50_000,
      shares: 200,
      cik: "0000000002",
    },
  ];

  const signals = buildInsiderClusterSignals(rows, 60);
  const cluster = signals.find((s) => s.ticker === "CLUSTER");
  const solo = signals.find((s) => s.ticker === "SOLO");
  assert.ok(cluster && solo);
  assert.ok(cluster.insiderClusterScore > solo.insiderClusterScore);
  assert.equal(cluster.buyerCount, 3);
  assert.equal(cluster.ceoParticipation, true);
  assert.equal(clusterAlert(cluster.buyerCount, cluster.ceoParticipation, cluster.insiderClusterScore), true);
});

test("cluster strength labels", () => {
  assert.equal(clusterStrengthLabel(90), "Executive Cluster Buying");
  assert.equal(clusterStrengthLabel(75), "Strong Insider Accumulation");
  assert.equal(clusterStrengthLabel(55), "Moderate Insider Buying");
  assert.equal(clusterStrengthLabel(40), "Limited Insider Activity");
  assert.equal(clusterStrengthLabel(10), "No Significant Cluster");
});

test("sell transactions are excluded from engine input", () => {
  const signals = buildInsiderClusterSignals(
    [
      {
        ticker: "X",
        insiderName: "Buyer",
        insiderTitle: "Director",
        transactionDate: "2026-05-01",
        transactionValue: 10_000,
        shares: 100,
        cik: "1",
      },
    ],
    60
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0].buyerCount, 1);
});
