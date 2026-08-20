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

test("normalizeFiscalPeriod: annual forms are always FY even when fp is Q1", () => {
  const obs = { form: "10-K", fp: "Q1", fy: 2024 } as XbrlFactObservation;
  assert.equal(normalizeFiscalPeriod(obs, "annual"), "FY");
  assert.equal(normalizeFiscalPeriod(obs, "quarterly"), null);
});

test("normalizeFiscalPeriod: 20-F counts as annual FY; 6-K Q2 as interim", () => {
  assert.equal(
    normalizeFiscalPeriod({ form: "20-F", fp: "FY", fy: 2024 } as XbrlFactObservation, "annual"),
    "FY"
  );
  assert.equal(
    normalizeFiscalPeriod({ form: "6-K", fp: "Q2", fy: 2024 } as XbrlFactObservation, "quarterly"),
    "Q2"
  );
  assert.equal(
    normalizeFiscalPeriod({ form: "6-K", fp: "FY", fy: 2024 } as XbrlFactObservation, "quarterly"),
    null
  );
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
  assert.equal(q2.derivedStandalone, true);
});

test("normalizeQuarterlyDurations derives Q3 from 9M YTD minus prior 6M YTD", async () => {
  const { normalizeQuarterlyDurations } = await import("./durationNormalize.js");
  const observations: XbrlFactObservation[] = [
    {
      end: "2026-06-27",
      start: "2025-09-28",
      val: 116_996_000_000,
      fy: 2026,
      fp: "Q3",
      form: "10-Q",
      filed: "2026-08-01",
    },
    {
      end: "2026-03-28",
      start: "2025-09-28",
      val: 80_000_000_000,
      fy: 2026,
      fp: "Q2",
      form: "10-Q",
      filed: "2026-05-02",
    },
  ];
  const normalized = normalizeQuarterlyDurations(observations);
  const q3 = normalized.get("Q3|2026-06-27");
  assert.ok(q3);
  assert.equal(q3.reportedValue, 116_996_000_000);
  assert.equal(q3.normalizedQuarterValue, 36_996_000_000);
  assert.equal(q3.durationBucket, "nine_m_ytd");
  assert.equal(q3.derivedStandalone, true);
});

test("normalizeQuarterlyDurations does not treat 9M YTD as Q3 without prior H1", async () => {
  const { normalizeQuarterlyDurations } = await import("./durationNormalize.js");
  const observations: XbrlFactObservation[] = [
    {
      end: "2026-06-27",
      start: "2025-09-28",
      val: 116_996_000_000,
      fy: 2026,
      fp: "Q3",
      form: "10-Q",
      filed: "2026-08-01",
    },
  ];
  const normalized = normalizeQuarterlyDurations(observations);
  const q3 = normalized.get("Q3|2026-06-27");
  assert.ok(q3);
  assert.equal(q3.reportedValue, 116_996_000_000);
  assert.equal(q3.normalizedQuarterValue, null);
  assert.equal(q3.durationBucket, "nine_m_ytd");
  assert.equal(q3.derivedStandalone, false);
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
    assert.equal(fy2024.fy, 2024, "period ending 2024-09-28 must be labeled FY2024, not a later comparative fy");
    assert.ok(
      withinPct(fy2024.metrics.revenue!, 391_000_000_000, 3),
      `FY2024 revenue ${fy2024.metrics.revenue} not near $391B`
    );

    const expectedFyByEnd: Record<string, number> = {
      "2025-09-27": 2025,
      "2024-09-28": 2024,
      "2023-09-30": 2023,
      "2022-09-24": 2022,
      "2021-09-25": 2021,
    };
    for (const [end, fy] of Object.entries(expectedFyByEnd)) {
      const row = annual.find((r) => r.end === end && r.metrics.revenue != null);
      assert.ok(row, `missing annual row for ${end}`);
      assert.equal(row.fy, fy, `${end} labeled FY${row.fy}, expected FY${fy}`);
    }

    const fy2025 = annual.find((r) => r.end === "2025-09-27" && r.metrics.revenue != null);
    assert.equal(fy2025?.derived.revenue_growth_yoy, 6.4);
    assert.equal(fy2024.derived.revenue_growth_yoy, 2.0);
    const fy2023 = annual.find((r) => r.end === "2023-09-30" && r.metrics.revenue != null);
    const fy2022 = annual.find((r) => r.end === "2022-09-24" && r.metrics.revenue != null);
    assert.equal(fy2023?.derived.revenue_growth_yoy, -2.8);
    assert.equal(fy2022?.derived.revenue_growth_yoy, 7.8);

    const fy2025Assets = annual.find((r) => r.end === "2025-09-27");
    assert.equal(fy2025Assets?.metrics.total_assets, 359_241_000_000);

    const q1fy2026 = findQuarterlyRow(quarterly, "Q1", "2025-12-27");
    const q2fy2026 = findQuarterlyRow(quarterly, "Q2", "2026-03-28");
    const q3fy2026 = findQuarterlyRow(quarterly, "Q3", "2026-06-27");
    assert.ok(q1fy2026 && q2fy2026 && q3fy2026);
    assert.notEqual(q1fy2026.metrics.total_assets, 359_241_000_000);
    assert.notEqual(q2fy2026.metrics.total_assets, 359_241_000_000);
    assert.ok(q3fy2026.metrics.total_assets);
    assert.notEqual(q3fy2026.metrics.total_assets, 359_241_000_000);
    assert.ok(
      !quarterly.some((r) => r.end === "2025-09-27" && (r.fp === "Q1" || r.fp === "Q2" || r.fp === "Q3")),
      "FYE 2025-09-27 assets must not appear as FY2026 quarterly rows"
    );

    const q2fy2025 = findQuarterlyRow(quarterly, "Q2", "2025-03-29");
    assert.ok(q2fy2025?.metrics.revenue, "Q2 FY2025 revenue missing");
    assert.equal(q1fy2026.fy, 2026);
    assert.equal(q2fy2026.fy, 2026);
    assert.equal(q3fy2026.fy, 2026);
    assert.equal(q2fy2025.fy, 2025);
    const q3fy2025 = findQuarterlyRow(quarterly, "Q3", "2025-06-28");
    assert.equal(q3fy2025?.fy, 2025, "period ending 2025-06-28 must be FY2025, not a later 10-Q comparative fy");
    const fy2026Count = quarterly.filter((r) => r.fy === 2026).length;
    assert.ok(fy2026Count <= 3, `FY2026 should have at most Q1–Q3, got ${fy2026Count}`);
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
