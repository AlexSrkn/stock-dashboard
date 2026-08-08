import test from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";
import { fetchCompanyFacts, clearCompanyFactsCache } from "./companyFacts.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import { normalizeQuarterlyDurationForFy } from "./durationNormalize.js";
import { normalizeFiscalPeriod } from "./periodUtils.js";
import type { SecCompanyFacts, XbrlFactObservation } from "./types.js";

const APPLE_CIK = "0000320193";
const BILLION = 1_000_000_000;

function withinPct(actual: number, expected: number, pct: number): boolean {
  const delta = Math.abs(actual - expected) / expected;
  return delta <= pct / 100;
}

function findQuarterlyRow(
  quarterly: ReturnType<typeof extractFinancialsFromCompanyFacts>["quarterly"],
  fp: string,
  periodEnd: string
) {
  return quarterly.find((r) => r.fp === fp && r.end === periodEnd);
}

test("normalizeFiscalPeriod: 10-K is always FY even when fp is Q1", () => {
  const obs = { form: "10-K", fp: "Q1", fy: 2024 } as XbrlFactObservation;
  assert.equal(normalizeFiscalPeriod(obs, "annual"), "FY");
  assert.equal(normalizeFiscalPeriod(obs, "quarterly"), null);
});

test("normalizeQuarterlyDurationForFy derives Q2 from H1 YTD minus Q1", () => {
  const observations: XbrlFactObservation[] = [
    {
      end: "2025-03-29",
      start: "2024-09-29",
      val: 219_000_000_000,
      fy: 2025,
      fp: "Q2",
      form: "10-Q",
      filed: "2025-05-02",
    },
    {
      end: "2024-12-28",
      start: "2024-09-29",
      val: 124_000_000_000,
      fy: 2025,
      fp: "Q1",
      form: "10-Q",
      filed: "2025-01-31",
    },
  ];

  const normalized = normalizeQuarterlyDurationForFy(observations);
  const q2 = normalized.get("Q2");
  assert.ok(q2);
  assert.equal(q2.reportedValue, 219_000_000_000);
  assert.equal(q2.normalizedQuarterValue, 95_000_000_000);
  assert.equal(q2.durationBucket, "h1_ytd");
});

test("Q2 YTD revenue is normalized to quarter-only in extractFinancialsFromCompanyFacts", () => {
  const fixture: SecCompanyFacts = {
    cik: APPLE_CIK,
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              {
                end: "2025-03-29",
                start: "2024-09-29",
                val: 219_300_000_000,
                fy: 2025,
                fp: "Q2",
                form: "10-Q",
                filed: "2025-05-02",
                accn: "0000320193-25-000057",
              },
              {
                end: "2024-12-28",
                start: "2024-09-29",
                val: 123_900_000_000,
                fy: 2025,
                fp: "Q1",
                form: "10-Q",
                filed: "2025-01-31",
                accn: "0000320193-25-000008",
              },
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              {
                end: "2025-03-29",
                val: 344_000_000_000,
                fy: 2025,
                fp: "Q2",
                form: "10-Q",
                filed: "2025-05-02",
              },
            ],
          },
        },
        Liabilities: {
          units: {
            USD: [
              {
                end: "2025-03-29",
                val: 265_000_000_000,
                fy: 2025,
                fp: "Q2",
                form: "10-Q",
                filed: "2025-05-02",
              },
            ],
          },
        },
        StockholdersEquity: {
          units: {
            USD: [
              {
                end: "2025-03-29",
                val: 79_000_000_000,
                fy: 2025,
                fp: "Q2",
                form: "10-Q",
                filed: "2025-05-02",
              },
            ],
          },
        },
      },
    },
  };

  const { quarterly } = extractFinancialsFromCompanyFacts(fixture);
  const q2 = findQuarterlyRow(quarterly, "Q2", "2025-03-29");
  assert.ok(q2);
  assert.equal(q2.metrics.revenue, 95_400_000_000);
  assert.equal(q2.metricDetails.revenue?.reportedValue, 219_300_000_000);
  assert.equal(q2.metricDetails.revenue?.normalizedQuarterValue, 95_400_000_000);
  assert.ok(q2.metrics.total_assets);
  assert.ok(q2.metrics.total_liabilities);
  assert.ok(q2.metrics.shareholder_equity);
});

test("10-K mislabeled Q1 appears as annual FY", () => {
  const fixture: SecCompanyFacts = {
    cik: APPLE_CIK,
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              {
                end: "2024-09-28",
                start: "2023-10-01",
                val: 391_035_000_000,
                fy: 2024,
                fp: "Q1",
                form: "10-K",
                filed: "2024-11-01",
              },
            ],
          },
        },
      },
    },
  };

  const { annual } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(annual.length, 1);
  assert.equal(annual[0]?.fp, "FY");
  assert.equal(annual[0]?.metrics.revenue, 391_035_000_000);
});

const hasSecUserAgent = Boolean(process.env.SEC_USER_AGENT?.trim());

test(
  "Apple SEC Company Facts: FY2024 revenue, Q2 FY2025 revenue, balance sheet",
  { skip: !hasSecUserAgent },
  async () => {
    clearCompanyFactsCache();
    const facts = await fetchCompanyFacts(APPLE_CIK);
    const { annual, quarterly } = extractFinancialsFromCompanyFacts(facts);

    const fy2024 = annual.find((r) => r.end === "2024-09-28" && r.metrics.revenue != null);
    assert.ok(fy2024?.metrics.revenue, "FY2024 revenue missing");
    assert.ok(
      withinPct(fy2024.metrics.revenue!, 391_000_000_000, 3),
      `FY2024 revenue ${fy2024.metrics.revenue} not near $391B`
    );

    const q2fy2025 = findQuarterlyRow(quarterly, "Q2", "2025-03-29");
    assert.ok(q2fy2025?.metrics.revenue, "Q2 FY2025 revenue missing");
    assert.ok(
      withinPct(q2fy2025.metrics.revenue!, 95_000_000_000, 8),
      `Q2 FY2025 revenue ${q2fy2025.metrics.revenue} not near $95B`
    );

    const balanceRow = q2fy2025 ?? quarterly[0] ?? annual[0];
    assert.ok(balanceRow, "no row for balance sheet checks");
    assert.ok(balanceRow.metrics.total_assets, "total assets missing");
    assert.ok(balanceRow.metrics.total_liabilities, "total liabilities missing");
    assert.ok(balanceRow.metrics.shareholder_equity, "shareholder equity missing");
  }
);
