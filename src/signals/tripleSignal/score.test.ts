import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTripleSignalStrengthScore } from "./score.js";

describe("computeTripleSignalStrengthScore", () => {
  it("returns 0 for empty activity", () => {
    assert.equal(
      computeTripleSignalStrengthScore({
        institutionCount: 0,
        insiderPurchaseCount: 0,
        politicianPurchaseCount: 0,
        totalInstitutionalValueUsd: 0,
        totalInsiderPurchaseUsd: 0,
        totalPoliticianPurchaseUsd: 0,
      }),
      0
    );
  });

  it("increases when politician buying is present", () => {
    const withoutPol = computeTripleSignalStrengthScore({
      institutionCount: 2,
      insiderPurchaseCount: 2,
      politicianPurchaseCount: 0,
      totalInstitutionalValueUsd: 1e8,
      totalInsiderPurchaseUsd: 1e5,
      totalPoliticianPurchaseUsd: 0,
    });
    const withPol = computeTripleSignalStrengthScore({
      institutionCount: 2,
      insiderPurchaseCount: 2,
      politicianPurchaseCount: 2,
      totalInstitutionalValueUsd: 1e8,
      totalInsiderPurchaseUsd: 1e5,
      totalPoliticianPurchaseUsd: 5e4,
    });
    assert.ok(withPol > withoutPol);
    assert.ok(withPol <= 100);
  });
});
