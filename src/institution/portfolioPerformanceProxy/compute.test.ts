import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProxyFilters,
  buildHistoryPoints,
  compareProxyRows,
  dollarChange,
  metricsAtQuarter,
  pctChange,
  shiftQuartersBack,
} from "./compute.js";
import type { PortfolioProxyRankingRow } from "./types.js";

function row(partial: Partial<PortfolioProxyRankingRow>): PortfolioProxyRankingRow {
  return {
    rank: 0,
    cik: "0000000001",
    name: "Test Fund",
    type: "Asset Manager",
    quarter: "2025-Q2",
    latestFilingDate: "2025-08-14",
    currentPortfolioValueUsd: 100,
    previousPortfolioValueUsd: 90,
    qoqChangeUsd: 10,
    qoqChangePct: 11.11,
    yearAgoPortfolioValueUsd: 80,
    change1yUsd: 20,
    change1yPct: 25,
    threeYearAgoPortfolioValueUsd: null,
    change3yUsd: null,
    change3yPct: null,
    holdingsCount: 50,
    history: [],
    ...partial,
  };
}

describe("portfolio performance proxy math", () => {
  it("computes QoQ and 1Y changes without inventing missing quarters", () => {
    assert.equal(dollarChange(247, 200), 47);
    assert.equal(pctChange(247, 200), 23.5);
    assert.equal(pctChange(100, 0), null);
    assert.equal(dollarChange(100, null), null);
    assert.equal(shiftQuartersBack("2026-Q2", 4), "2025-Q2");
    assert.equal(shiftQuartersBack("2026-Q2", 12), "2023-Q2");
  });

  it("builds history QoQ only when the prior calendar quarter exists", () => {
    const history = buildHistoryPoints([
      {
        institutionId: "1",
        quarter: "2025-Q1",
        filingDate: "2025-05-01",
        holdingsCount: 10,
        portfolioValueUsd: 100,
      },
      {
        institutionId: "1",
        quarter: "2025-Q3",
        filingDate: "2025-11-01",
        holdingsCount: 12,
        portfolioValueUsd: 130,
      },
    ]);
    assert.equal(history.length, 2);
    assert.equal(history[0].qoqChangePct, null);
    // Q3 has no Q2 snapshot → N/A (do not bridge Q1→Q3)
    assert.equal(history[1].qoqChangeUsd, null);
    assert.equal(history[1].qoqChangePct, null);
  });

  it("metricsAtQuarter uses exact year-ago quarter only", () => {
    const history = buildHistoryPoints([
      {
        institutionId: "1",
        quarter: "2025-Q2",
        filingDate: null,
        holdingsCount: 8,
        portfolioValueUsd: 80,
      },
      {
        institutionId: "1",
        quarter: "2026-Q2",
        filingDate: null,
        holdingsCount: 10,
        portfolioValueUsd: 100,
      },
    ]);
    const m = metricsAtQuarter(history, "2026-Q2");
    assert.equal(m.current?.portfolioValueUsd, 100);
    assert.equal(m.previous, null); // no 2026-Q1
    assert.equal(m.yearAgo?.portfolioValueUsd, 80);
    assert.equal(m.threeYearAgo, null);
  });

  it("sorts by 1Y growth with nulls last and filters by thresholds", () => {
    const a = row({ name: "A", change1yPct: 10, currentPortfolioValueUsd: 50 });
    const b = row({ name: "B", change1yPct: 30, currentPortfolioValueUsd: 200 });
    const c = row({ name: "C", change1yPct: null, currentPortfolioValueUsd: 500 });
    const sorted = [a, b, c].sort((x, y) => compareProxyRows(x, y, "growth_1y", "desc"));
    assert.deepEqual(
      sorted.map((r) => r.name),
      ["B", "A", "C"]
    );

    const filtered = applyProxyFilters([a, b, c], {
      minPortfolioValue: 100,
      minGrowth1yPct: 20,
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].name, "B");
  });
});
