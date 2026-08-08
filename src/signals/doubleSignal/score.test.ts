import assert from "node:assert/strict";
import test from "node:test";
import { computeSignalStrengthScore } from "./score.js";

test("computeSignalStrengthScore returns 0-100", () => {
  const low = computeSignalStrengthScore({
    institutionCount: 1,
    insiderPurchaseCount: 1,
    totalInstitutionalValueUsd: 100_000,
    totalInsiderPurchaseUsd: 10_000,
  });
  assert.ok(low >= 0 && low <= 100);

  const high = computeSignalStrengthScore({
    institutionCount: 8,
    insiderPurchaseCount: 5,
    totalInstitutionalValueUsd: 500_000_000,
    totalInsiderPurchaseUsd: 2_000_000,
  });
  assert.ok(high > low);
  assert.ok(high <= 100);
});

test("computeSignalStrengthScore rewards multiple buyers", () => {
  const single = computeSignalStrengthScore({
    institutionCount: 1,
    insiderPurchaseCount: 1,
    totalInstitutionalValueUsd: 1_000_000,
    totalInsiderPurchaseUsd: 100_000,
  });
  const multi = computeSignalStrengthScore({
    institutionCount: 3,
    insiderPurchaseCount: 3,
    totalInstitutionalValueUsd: 1_000_000,
    totalInsiderPurchaseUsd: 100_000,
  });
  assert.ok(multi > single);
});
