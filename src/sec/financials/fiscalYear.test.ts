import test from "node:test";
import assert from "node:assert/strict";
import { resolveAnnualFiscalYear, fiscalYearFromFrame } from "./fiscalYear.js";
import { pickAnnualDurationValue } from "./durationNormalize.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import type { SecCompanyFacts, XbrlFactObservation } from "./types.js";

function annualObs(partial: Partial<XbrlFactObservation> & { end: string; val: number; fy: number; filed: string }): XbrlFactObservation {
  const end = partial.end;
  const startYear = Number(end.slice(0, 4)) - 1;
  return {
    start: partial.start ?? `${startYear}${end.slice(4)}`,
    form: "10-K",
    fp: "FY",
    ...partial,
  };
}

test("resolveAnnualFiscalYear uses original 10-K fy, not later comparative fy", () => {
  const end = "2023-09-30";
  const observations: XbrlFactObservation[] = [
    annualObs({
      end,
      start: "2022-09-25",
      val: 383e9,
      fy: 2023,
      filed: "2023-11-03",
      accn: "aapl-2023",
    }),
    annualObs({
      end,
      start: "2022-09-25",
      val: 383e9,
      fy: 2024,
      filed: "2024-11-01",
      accn: "aapl-2024",
    }),
    annualObs({
      end,
      start: "2022-09-25",
      val: 383e9,
      fy: 2025,
      filed: "2025-10-31",
      accn: "aapl-2025",
    }),
  ];
  assert.equal(resolveAnnualFiscalYear(observations, end), 2023);
});

test("resolveAnnualFiscalYear works for December fiscal year-end", () => {
  const end = "2024-12-31";
  const observations: XbrlFactObservation[] = [
    annualObs({
      end,
      start: "2024-01-01",
      val: 100e9,
      fy: 2024,
      filed: "2025-02-15",
      accn: "cal-2024",
    }),
    annualObs({
      end,
      start: "2024-01-01",
      val: 101e9,
      fy: 2025,
      filed: "2026-02-20",
      accn: "cal-2025",
    }),
  ];
  assert.equal(resolveAnnualFiscalYear(observations, end), 2024);
});

test("resolveAnnualFiscalYear works for January (non-calendar) fiscal year-end", () => {
  // Retail-style FY ending late January — SEC fy on the original 10-K is authoritative.
  const end = "2024-02-02";
  const observations: XbrlFactObservation[] = [
    annualObs({
      end,
      start: "2023-01-29",
      val: 50e9,
      fy: 2024,
      filed: "2024-03-20",
      accn: "retail-2024",
    }),
    annualObs({
      end,
      start: "2023-01-29",
      val: 50e9,
      fy: 2025,
      filed: "2025-03-18",
      accn: "retail-2025",
    }),
  ];
  assert.equal(resolveAnnualFiscalYear(observations, end), 2024);
});

test("pickAnnualDurationValue prefers restated value but ignores non-annual durations", () => {
  const end = "2023-09-30";
  const observations: XbrlFactObservation[] = [
    annualObs({
      end,
      start: "2022-09-25",
      val: 380e9,
      fy: 2023,
      filed: "2023-11-03",
    }),
    annualObs({
      end,
      start: "2022-09-25",
      val: 383e9,
      fy: 2025,
      filed: "2025-10-31",
    }),
    // Quarterly stub in a 10-K must not be selected as annual.
    {
      end: "2023-12-30",
      start: "2023-10-01",
      val: 90e9,
      fy: 2024,
      fp: "Q1",
      form: "10-K",
      filed: "2024-11-01",
    },
  ];
  const pick = pickAnnualDurationValue(observations.filter((o) => o.end === end));
  assert.ok(pick);
  assert.equal(pick.reportedValue, 383e9);
  assert.equal(pick.obs.fy, 2025); // value source may be restatement
  assert.equal(pickAnnualDurationValue([observations[2]!]), null);
});

test("extractFinancials: AAPL-style Sept FY — comparative 10-K values keep original fy labels", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              // Original filings
              annualObs({
                end: "2025-09-27",
                start: "2024-09-29",
                val: 416e9,
                fy: 2025,
                filed: "2025-10-31",
                accn: "aapl-25",
              }),
              annualObs({
                end: "2024-09-28",
                start: "2023-10-01",
                val: 391e9,
                fy: 2024,
                filed: "2024-11-01",
                accn: "aapl-24",
              }),
              annualObs({
                end: "2023-09-30",
                start: "2022-09-25",
                val: 383e9,
                fy: 2023,
                filed: "2023-11-03",
                accn: "aapl-23",
              }),
              // Comparatives inside FY2025 10-K (wrong fy tag on purpose)
              annualObs({
                end: "2024-09-28",
                start: "2023-10-01",
                val: 391.035e9,
                fy: 2025,
                filed: "2025-10-31",
                accn: "aapl-25",
              }),
              annualObs({
                end: "2023-09-30",
                start: "2022-09-25",
                val: 383.285e9,
                fy: 2025,
                filed: "2025-10-31",
                accn: "aapl-25",
              }),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              { end: "2025-09-27", val: 365e9, fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31", accn: "aapl-25" },
              { end: "2024-09-28", val: 365e9, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", accn: "aapl-24" },
              { end: "2024-09-28", val: 364.98e9, fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31", accn: "aapl-25" },
              { end: "2023-09-30", val: 352e9, fy: 2023, fp: "FY", form: "10-K", filed: "2023-11-03", accn: "aapl-23" },
              { end: "2023-09-30", val: 352.58e9, fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31", accn: "aapl-25" },
            ],
          },
        },
      },
    },
  };

  const { annual } = extractFinancialsFromCompanyFacts(fixture);
  const byEnd = Object.fromEntries(annual.map((r) => [r.end, r]));

  assert.equal(byEnd["2025-09-27"]?.fy, 2025);
  assert.equal(byEnd["2024-09-28"]?.fy, 2024);
  assert.equal(byEnd["2023-09-30"]?.fy, 2023);

  // Restated values still preferred
  assert.equal(byEnd["2024-09-28"]?.metrics.revenue, 391.035e9);
  assert.equal(byEnd["2023-09-30"]?.metrics.revenue, 383.285e9);
  assert.equal(byEnd["2024-09-28"]?.metrics.total_assets, 364.98e9);
});

test("extractFinancials: December FY company — comparative values keep original fy", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000789019",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              annualObs({
                end: "2024-12-31",
                start: "2024-01-01",
                val: 200e9,
                fy: 2024,
                filed: "2025-02-01",
                accn: "msft-24",
              }),
              annualObs({
                end: "2023-12-31",
                start: "2023-01-01",
                val: 180e9,
                fy: 2023,
                filed: "2024-02-01",
                accn: "msft-23",
              }),
              annualObs({
                end: "2023-12-31",
                start: "2023-01-01",
                val: 181e9,
                fy: 2024,
                filed: "2025-02-01",
                accn: "msft-24",
              }),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              { end: "2024-12-31", val: 500e9, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01", accn: "msft-24" },
              { end: "2023-12-31", val: 450e9, fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-01", accn: "msft-23" },
              { end: "2023-12-31", val: 451e9, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01", accn: "msft-24" },
            ],
          },
        },
      },
    },
  };

  const { annual } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(annual.find((r) => r.end === "2024-12-31")?.fy, 2024);
  assert.equal(annual.find((r) => r.end === "2023-12-31")?.fy, 2023);
  assert.equal(annual.find((r) => r.end === "2023-12-31")?.metrics.revenue, 181e9);
});

test("extractFinancials: does not promote 10-K quarterly comparatives to annual FY rows", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              annualObs({
                end: "2024-09-28",
                start: "2023-10-01",
                val: 391e9,
                fy: 2024,
                filed: "2024-11-01",
                accn: "aapl-24",
              }),
              // ~90-day comparative inside 10-K — must not become FY
              {
                end: "2023-12-30",
                start: "2023-10-01",
                val: 119e9,
                fy: 2024,
                fp: "Q1",
                form: "10-K",
                filed: "2024-11-01",
                accn: "aapl-24",
              },
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              { end: "2024-09-28", val: 365e9, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", accn: "aapl-24" },
            ],
          },
        },
      },
    },
  };

  const { annual } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(annual.length, 1);
  assert.equal(annual[0]?.end, "2024-09-28");
  assert.equal(annual[0]?.fy, 2024);
  assert.ok(!annual.some((r) => r.end === "2023-12-30"));
});

test("fiscalYearFromFrame parses CY frames without treating them as fiscal truth alone", () => {
  assert.equal(fiscalYearFromFrame("CY2023"), 2023);
  assert.equal(fiscalYearFromFrame("CY2023Q4"), 2023);
  assert.equal(fiscalYearFromFrame(null), null);
});
