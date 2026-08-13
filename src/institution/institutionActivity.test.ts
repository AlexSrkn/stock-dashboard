import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyInstitutionActivity,
  partitionInstitutionActivity,
  valueAttributableToShareChange,
} from "./institutionAnalytics.js";
import type { InstitutionActivityRow } from "./types.js";

function row(partial: Partial<InstitutionActivityRow> & {
  ticker: string;
  previousShares: number;
  currentShares: number;
}): InstitutionActivityRow {
  const previousShares = partial.previousShares;
  const currentShares = partial.currentShares;
  const previousValueUsd = partial.previousValueUsd ?? null;
  const currentValueUsd = partial.currentValueUsd ?? null;
  const sharesChange = currentShares - previousShares;
  return {
    cusip: partial.cusip ?? partial.ticker,
    ticker: partial.ticker,
    issuer: partial.issuer ?? partial.ticker,
    previousShares,
    currentShares,
    sharesChange,
    sharesChangePct:
      previousShares > 0 ? Math.round(((currentShares - previousShares) / previousShares) * 1000) / 10 : null,
    previousValueUsd,
    currentValueUsd,
    valueChangeUsd:
      partial.valueChangeUsd ??
      valueAttributableToShareChange(previousShares, currentShares, previousValueUsd, currentValueUsd),
  };
}

test("classifyInstitutionActivity uses share counts only", () => {
  // DVA: shares down even if market value rose
  assert.equal(classifyInstitutionActivity(31_759_065, 30_100_585), "trim");
  // GOOGL: shares up
  assert.equal(classifyInstitutionActivity(17_846_142, 54_249_798), "add");
  // DAL: new
  assert.equal(classifyInstitutionActivity(0, 39_809_456), "new");
  // V / MA: closed
  assert.equal(classifyInstitutionActivity(8_297_460, 0), "closed");
  assert.equal(classifyInstitutionActivity(3_986_648, 0), "closed");
  // LEN: add
  assert.equal(classifyInstitutionActivity(7_050_950, 10_099_642), "add");
});

test("DVA share reduction is never an add even when 13F market value rises", () => {
  const priorShares = 31_759_065;
  const currentShares = 30_100_585;
  const priorValue = 4_000_000_000;
  // Price rose enough that reported market value is higher despite fewer shares.
  const currentValue = 4_500_000_000;
  assert.ok(currentValue - priorValue > 0);

  const kind = classifyInstitutionActivity(priorShares, currentShares);
  assert.equal(kind, "trim");

  const valueAdded = valueAttributableToShareChange(
    priorShares,
    currentShares,
    priorValue,
    currentValue
  );
  assert.ok(valueAdded != null && valueAdded < 0);

  const partitioned = partitionInstitutionActivity([
    row({
      ticker: "DVA",
      previousShares: priorShares,
      currentShares,
      previousValueUsd: priorValue,
      currentValueUsd: currentValue,
    }),
  ]);
  assert.equal(partitioned.adds.length, 0);
  assert.equal(partitioned.trims.length, 1);
  assert.equal(partitioned.trims[0]?.ticker, "DVA");
});

test("partitionInstitutionActivity places Berkshire-style movers correctly", () => {
  const rows = [
    row({
      ticker: "DVA",
      previousShares: 31_759_065,
      currentShares: 30_100_585,
      previousValueUsd: 4.2e9,
      currentValueUsd: 4.5e9, // value up, shares down
    }),
    row({
      ticker: "GOOGL",
      previousShares: 17_846_142,
      currentShares: 54_249_798,
      previousValueUsd: 2.5e9,
      currentValueUsd: 8.0e9,
    }),
    row({
      ticker: "DAL",
      previousShares: 0,
      currentShares: 39_809_456,
      previousValueUsd: null,
      currentValueUsd: 1.8e9,
    }),
    row({
      ticker: "V",
      previousShares: 8_297_460,
      currentShares: 0,
      previousValueUsd: 2.1e9,
      currentValueUsd: null,
    }),
    row({
      ticker: "MA",
      previousShares: 3_986_648,
      currentShares: 0,
      previousValueUsd: 1.5e9,
      currentValueUsd: null,
    }),
    row({
      ticker: "LEN",
      previousShares: 7_050_950,
      currentShares: 10_099_642,
      previousValueUsd: 0.9e9,
      currentValueUsd: 1.4e9,
    }),
  ];

  const { adds, trims, newPositions, completelySold, activity } = partitionInstitutionActivity(rows);

  assert.deepEqual(
    adds.map((r) => r.ticker).sort(),
    ["GOOGL", "LEN"]
  );
  assert.deepEqual(
    trims.map((r) => r.ticker),
    ["DVA"]
  );
  assert.deepEqual(
    newPositions.map((r) => r.ticker),
    ["DAL"]
  );
  assert.deepEqual(
    completelySold.map((r) => r.ticker).sort(),
    ["MA", "V"]
  );

  // Mutual exclusion
  const addTickers = new Set(adds.map((r) => r.ticker));
  const trimTickers = new Set(trims.map((r) => r.ticker));
  const newTickers = new Set(newPositions.map((r) => r.ticker));
  const closedTickers = new Set(completelySold.map((r) => r.ticker));
  for (const t of addTickers) {
    assert.ok(!trimTickers.has(t) && !newTickers.has(t) && !closedTickers.has(t));
  }
  for (const t of trimTickers) {
    assert.ok(!addTickers.has(t) && !newTickers.has(t) && !closedTickers.has(t));
  }
  for (const t of newTickers) {
    assert.ok(!addTickers.has(t) && !trimTickers.has(t) && !closedTickers.has(t));
  }

  // Adds never have negative share delta; trims never positive
  for (const r of adds) assert.ok(r.sharesChange > 0 && r.previousShares > 0);
  for (const r of trims) assert.ok(r.sharesChange < 0 && r.currentShares > 0);
  for (const r of newPositions) assert.equal(r.previousShares, 0);
  for (const r of completelySold) assert.equal(r.currentShares, 0);

  // All changes is the complete union
  assert.equal(activity.length, 6);
  assert.deepEqual(
    activity.map((r) => r.ticker).sort(),
    ["DAL", "DVA", "GOOGL", "LEN", "MA", "V"]
  );
});

test("valueAttributableToShareChange uses share delta × price, not raw MV delta", () => {
  // Add 100 shares; price fell so MV dropped — share-based value is still positive.
  const v = valueAttributableToShareChange(100, 200, 10_000, 8_000);
  // current price = 40; delta = +100; value = +4000
  assert.equal(v, 4000);
  assert.ok(8_000 - 10_000 < 0);
});
