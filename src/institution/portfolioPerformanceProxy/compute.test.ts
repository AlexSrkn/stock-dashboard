import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProxyFilters,
  buildHistoryPoints,
  compareProxyRows,
  dollarChange,
  latestQuarterForInstitution,
  metricsAtQuarter,
  pctChange,
  shiftQuartersBack,
} from "./compute.js";
import { formatProxyHoldings, formatProxyUsd } from "./formatDisplay.js";
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

/** Berkshire raw 13F portfolio totals (USD dollars). */
const BRK = {
  q2026q1: 263_095_703_570,
  q2025q4: 274_160_086_701,
  q2025q1: 258_701_144_516,
};

describe("portfolio performance proxy math", () => {
  it("Berkshire QoQ ≈ -4.04% from raw 13F totals", () => {
    const qoq = pctChange(BRK.q2026q1, BRK.q2025q4);
    assert.ok(qoq != null);
    assert.ok(Math.abs(qoq - -4.04) < 0.01);
    assert.equal(dollarChange(BRK.q2026q1, BRK.q2025q4), roundish(BRK.q2026q1 - BRK.q2025q4));
  });

  it("Berkshire 1Y ≈ +1.70% from raw 13F totals four quarters apart", () => {
    assert.equal(shiftQuartersBack("2026-Q1", 4), "2025-Q1");
    const y1 = pctChange(BRK.q2026q1, BRK.q2025q1);
    assert.ok(y1 != null);
    assert.ok(Math.abs(y1 - 1.7) < 0.05);
  });

  it("missing four-quarters-ago value produces N/A (null), not 0%", () => {
    const history = buildHistoryPoints([
      {
        institutionId: "0001067983",
        quarter: "2025-Q4",
        filingDate: null,
        holdingsCount: 110,
        portfolioValueUsd: BRK.q2025q4,
      },
      {
        institutionId: "0001067983",
        quarter: "2026-Q1",
        filingDate: null,
        holdingsCount: 90,
        portfolioValueUsd: BRK.q2026q1,
      },
    ]);
    const m = metricsAtQuarter(history, "2026-Q1");
    assert.equal(m.yearAgo, null);
    assert.equal(pctChange(m.current?.portfolioValueUsd, m.yearAgo?.portfolioValueUsd), null);
    assert.notEqual(pctChange(m.current?.portfolioValueUsd, m.yearAgo?.portfolioValueUsd), 0);
  });

  it("metricsAtQuarter wires current / previous / year-ago from raw dollars only", () => {
    const history = buildHistoryPoints([
      {
        institutionId: "0001067983",
        quarter: "2025-Q1",
        filingDate: "2025-05-15",
        holdingsCount: 110,
        portfolioValueUsd: BRK.q2025q1,
      },
      {
        institutionId: "0001067983",
        quarter: "2025-Q4",
        filingDate: "2026-02-17",
        holdingsCount: 110,
        portfolioValueUsd: BRK.q2025q4,
      },
      {
        institutionId: "0001067983",
        quarter: "2026-Q1",
        filingDate: "2026-05-15",
        holdingsCount: 90,
        portfolioValueUsd: BRK.q2026q1,
      },
    ]);
    const m = metricsAtQuarter(history, "2026-Q1");
    assert.equal(m.current?.portfolioValueUsd, BRK.q2026q1);
    assert.equal(m.previous?.portfolioValueUsd, BRK.q2025q4);
    assert.equal(m.yearAgo?.portfolioValueUsd, BRK.q2025q1);
    assert.ok(Math.abs((pctChange(m.current!.portfolioValueUsd, m.previous!.portfolioValueUsd) ?? 0) - -4.04) < 0.01);
    assert.ok(Math.abs((pctChange(m.current!.portfolioValueUsd, m.yearAgo!.portfolioValueUsd) ?? 0) - 1.7) < 0.05);
  });

  it("never treats a formatted display string as a calculation input", () => {
    const display = formatProxyUsd(BRK.q2026q1);
    assert.equal(display, "$263.10B");
    // Growth must use raw numbers — parsing display strings is forbidden / nonsensical here
    assert.equal(pctChange(Number(display), BRK.q2025q1), null);
  });

  it("formats portfolio USD with B/T thresholds (no 1000x inflation)", () => {
    assert.equal(formatProxyUsd(263_095_703_570), "$263.10B");
    assert.equal(formatProxyUsd(1_898_430_000_000), "$1.90T");
    assert.equal(formatProxyUsd(54_960_000), "$54.96M");
  });

  it("formats holdings as integer thousands separators", () => {
    assert.equal(formatProxyHoldings(4546), "4,546");
    assert.equal(formatProxyHoldings(20832), "20,832");
    assert.equal(formatProxyHoldings(13282), "13,282");
    assert.equal(formatProxyHoldings(5624), "5,624");
    assert.equal(formatProxyHoldings(6623), "6,623");
    assert.equal(formatProxyHoldings(19242), "19,242");
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
    assert.equal(history[1].qoqChangeUsd, null);
    assert.equal(history[1].qoqChangePct, null);
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

  it("latestQuarterForInstitution uses the filer's own last quarter", () => {
    const q = latestQuarterForInstitution(
      [
        {
          institutionId: "0001067983",
          quarter: "2025-Q4",
          filingDate: null,
          holdingsCount: 1,
          portfolioValueUsd: 1,
        },
        {
          institutionId: "0001067983",
          quarter: "2026-Q1",
          filingDate: null,
          holdingsCount: 1,
          portfolioValueUsd: 2,
        },
        {
          institutionId: "0001910344",
          quarter: "2026-Q2",
          filingDate: null,
          holdingsCount: 1,
          portfolioValueUsd: 3,
        },
      ],
      "1067983"
    );
    assert.equal(q, "2026-Q1");
  });
});

function roundish(n: number): number {
  return Math.round(n * 100) / 100;
}
