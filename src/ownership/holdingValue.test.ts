import assert from "node:assert/strict";
import test from "node:test";
import { filingValueUsd, resolvePositionValueUsd } from "./holdingValue.js";
import { overlayHolderValues } from "./ownershipCacheReader.js";
import { valueAttributableToShareChange } from "../institution/institutionAnalytics.js";
import type { FundHoldingAggregate } from "./types.js";

test("filingValueUsd uses 13F dollars as-is", () => {
  assert.equal(filingValueUsd(12_345_678.9), 12_345_678.9);
  assert.equal(filingValueUsd(0), null);
  assert.equal(filingValueUsd(null), null);
});

test("resolvePositionValueUsd prefers 13F value over live price", () => {
  assert.equal(resolvePositionValueUsd(100, 50_000, 999), 50_000);
  assert.equal(resolvePositionValueUsd(100, null, 12.5), 1_250);
  assert.equal(resolvePositionValueUsd(100, null, null), null);
});

test("overlayHolderValues copies 13F value by CIK", () => {
  const holders: FundHoldingAggregate[] = [
    { fundName: "Vanguard", filerCik: "0000102909", shares: 10, valueUsd: null, pctOutstanding: 1 },
  ];
  const valued = new Map<string, FundHoldingAggregate>([
    [
      "The Vanguard Group",
      {
        fundName: "The Vanguard Group",
        filerCik: "0000102909",
        shares: 10,
        valueUsd: 1_500_000,
        pctOutstanding: 1,
      },
    ],
  ]);
  const out = overlayHolderValues(holders, valued);
  assert.equal(out[0]?.valueUsd, 1_500_000);
});

test("value added is share-change times 13F implied price", () => {
  const added = valueAttributableToShareChange(100, 120, 10_000, 13_200);
  assert.equal(added, 2_200);
});
