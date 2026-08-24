import test from "node:test";
import assert from "node:assert/strict";
import {
  isOwnershipQuarterLikelyComplete,
  isOwnershipQuarterPairDataComplete,
  ownershipPctSeriesLooksComplete,
  filterFullyScrapedOwnershipQuarters,
  parseOwnershipChangesQuarter,
  pickDefaultOwnershipQuarter,
} from "./compute.js";

test("isOwnershipQuarterLikelyComplete waits until after 13F deadline + grace", () => {
  // Q2 2026 ends Jun 30 → deadline ~Aug 14 → ready ~Aug 28
  assert.equal(
    isOwnershipQuarterLikelyComplete("2026-Q2", new Date("2026-08-14T12:00:00Z")),
    false
  );
  assert.equal(
    isOwnershipQuarterLikelyComplete("2026-Q2", new Date("2026-08-28T12:00:00Z")),
    true
  );
  assert.equal(
    isOwnershipQuarterLikelyComplete("2026-Q1", new Date("2026-08-14T12:00:00Z")),
    true
  );
});

test("ownershipPctSeriesLooksComplete rejects near-zero scrape cliffs", () => {
  const full = Array.from({ length: 100 }, (_, i) => 20 + (i % 40));
  assert.equal(ownershipPctSeriesLooksComplete(full), true);

  const sparse = Array.from({ length: 100 }, (_, i) => (i < 5 ? 8 : 0.2));
  assert.equal(ownershipPctSeriesLooksComplete(sparse), false);
});

test("isOwnershipQuarterPairDataComplete keeps large share-delta sets without SO", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ticker: `T${i}`,
    companyName: null,
    sector: null,
    exchange: null,
    marketCapUsd: null,
    currentOwnershipPct: null,
    previousOwnershipPct: null,
    changePct: 5,
    institutionCount: 50,
    totalInstitutionalShares: 1_000_000,
    currentQuarter: "2026-Q1",
    previousQuarter: "2025-Q4",
  }));
  assert.equal(isOwnershipQuarterPairDataComplete(rows), true);
  assert.equal(isOwnershipQuarterPairDataComplete(rows.slice(0, 20)), false);
});

test("filterFullyScrapedOwnershipQuarters drops incomplete and sparse pairs", () => {
  const mk = (cur: number, prev: number) => ({
    ticker: "X",
    companyName: null,
    sector: null,
    exchange: null,
    marketCapUsd: null,
    currentOwnershipPct: cur,
    previousOwnershipPct: prev,
    changePct: cur - prev,
    institutionCount: 10,
    totalInstitutionalShares: 1,
    currentQuarter: "2025-Q1",
    previousQuarter: "2024-Q4",
  });
  const goodRows = Array.from({ length: 80 }, () => mk(40, 35));
  const sparseRows = Array.from({ length: 80 }, () => mk(0.3, 0.2));
  const cliffPair = Array.from({ length: 80 }, () => mk(22, 1.2)); // previous not scraped

  const filtered = filterFullyScrapedOwnershipQuarters(
    {
      quarters: ["2026-Q2", "2025-Q1", "2024-Q2", "2024-Q1"],
      defaultQuarter: "2026-Q2",
      byQuarter: {
        "2026-Q2": goodRows.map((r) => ({ ...r, currentQuarter: "2026-Q2" })),
        "2025-Q1": goodRows,
        "2024-Q2": cliffPair.map((r) => ({ ...r, currentQuarter: "2024-Q2" })),
        "2024-Q1": sparseRows.map((r) => ({ ...r, currentQuarter: "2024-Q1" })),
      },
    },
    new Date("2026-08-14T12:00:00Z")
  );

  assert.deepEqual(filtered.quarters, ["2025-Q1"]);
  assert.equal(filtered.defaultQuarter, "2025-Q1");
  assert.ok(filtered.byQuarter["2025-Q1"]);
  assert.equal(filtered.byQuarter["2026-Q2"], undefined);
  assert.equal(filtered.byQuarter["2024-Q2"], undefined);
  assert.equal(filtered.byQuarter["2024-Q1"], undefined);
});

test("pickDefaultOwnershipQuarter skips sparse newest quarter", () => {
  const quarters = ["2026-Q2", "2026-Q1", "2025-Q4"];
  const counts = new Map([
    ["2026-Q2", 40],
    ["2026-Q1", 200],
    ["2025-Q4", 190],
  ]);
  assert.equal(
    pickDefaultOwnershipQuarter(quarters, counts, new Date("2026-09-01T12:00:00Z")),
    "2026-Q1"
  );
});

test("pickDefaultOwnershipQuarter skips incomplete quarter by calendar even with full coverage", () => {
  const quarters = ["2026-Q2", "2026-Q1"];
  const counts = new Map([
    ["2026-Q2", 200],
    ["2026-Q1", 200],
  ]);
  assert.equal(
    pickDefaultOwnershipQuarter(quarters, counts, new Date("2026-08-14T12:00:00Z")),
    "2026-Q1"
  );
});

test("parseOwnershipChangesQuarter uses defaultQuarter for latest", () => {
  assert.equal(
    parseOwnershipChangesQuarter("latest", ["2026-Q2", "2026-Q1"], "2026-Q1"),
    "2026-Q1"
  );
  assert.equal(
    parseOwnershipChangesQuarter(null, ["2026-Q2", "2026-Q1"], "2026-Q1"),
    "2026-Q1"
  );
  assert.equal(
    parseOwnershipChangesQuarter("2026-Q2", ["2026-Q2", "2026-Q1"], "2026-Q1"),
    "2026-Q2"
  );
});
