import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizePortfolioValueSeriesUnits,
  normalizeThirteenFHoldingUsd,
  thirteenFValueLooksLikeThousands,
} from "./normalizeThirteenFUsd.js";
import { buildHistoryPoints } from "../institution/portfolioPerformanceProxy/compute.js";

describe("normalizeThirteenFUsd", () => {
  it("detects SEC thousands via implied price < $1", () => {
    // Radnor Merck 2025-Q2: 41378 thousands / 522708 shares
    assert.equal(thirteenFValueLooksLikeThousands(41378, 522708), true);
    assert.equal(normalizeThirteenFHoldingUsd(41378, 522708), 41_378_000);
    // Same position later stored as dollars
    assert.equal(thirteenFValueLooksLikeThousands(43_731_643, 521049), false);
    assert.equal(normalizeThirteenFHoldingUsd(43_731_643, 521049), 43_731_643);
  });

  it("scales earlier thousands segment when a ~1000× cliff appears", () => {
    const series = normalizePortfolioValueSeriesUnits([
      { portfolioValueUsd: 626_807, holdingsCount: 319 },
      { portfolioValueUsd: 657_344_388, holdingsCount: 314 },
      { portfolioValueUsd: 673_753_847, holdingsCount: 311 },
    ]);
    assert.ok(Math.abs(series[0]!.portfolioValueUsd - 626_807_000) < 1);
    assert.equal(series[1]!.portfolioValueUsd, 657_344_388);
    assert.equal(series[2]!.portfolioValueUsd, 673_753_847);
  });

  it("Radnor-style history gets a sane Q2→Q3 QoQ after unit fix", () => {
    const history = buildHistoryPoints([
      {
        institutionId: "0001696867",
        quarter: "2025-Q2",
        filingDate: "2025-07-16",
        holdingsCount: 319,
        portfolioValueUsd: 626_807, // thousands in DB
      },
      {
        institutionId: "0001696867",
        quarter: "2025-Q3",
        filingDate: "2025-10-16",
        holdingsCount: 314,
        portfolioValueUsd: 657_344_388, // dollars in DB
      },
      {
        institutionId: "0001696867",
        quarter: "2025-Q4",
        filingDate: "2026-01-16",
        holdingsCount: 311,
        portfolioValueUsd: 673_753_847,
      },
    ]);
    const q3 = history.find((h) => h.quarter === "2025-Q3");
    assert.ok(q3);
    assert.ok(q3!.qoqChangePct != null);
    assert.ok(Math.abs(q3!.qoqChangePct! - 4.87) < 0.2);
    assert.ok(Math.abs(q3!.qoqChangePct!) < 20);
  });
});
