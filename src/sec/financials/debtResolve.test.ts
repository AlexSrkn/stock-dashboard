import test from "node:test";
import assert from "node:assert/strict";
import { classifyDebtTag, resolveTotalDebt } from "./debtResolve.js";
import { refineLongTermDebtMetric, computeDerivedForPeriod } from "./derivedMetrics.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import type { FinancialPeriodRow, SecCompanyFacts } from "./types.js";

test("classifyDebtTag separates balance-sheet roles from footnotes", () => {
  assert.equal(classifyDebtTag("LongTermDebtNoncurrent"), "noncurrent");
  assert.equal(classifyDebtTag("LongTermDebtCurrent"), "current_term");
  assert.equal(classifyDebtTag("CommercialPaper"), "commercial_paper");
  assert.equal(classifyDebtTag("LongTermDebt"), "aggregate_term");
  assert.equal(classifyDebtTag("DebtInstrumentCarryingAmount"), "footnote");
  assert.equal(classifyDebtTag("ShortTermBorrowings"), "short_term_borrowings");
});

test("total debt: noncurrent + current + commercial paper (no double count)", () => {
  const resolved = resolveTotalDebt({
    longTermDebt: 71_340_000_000,
    currentDebt: 11_010_000_000,
    commercialPaper: 1_990_000_000,
    longTermSource: {
      gaapTag: "LongTermDebtNoncurrent",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
    currentSource: {
      gaapTag: "LongTermDebtCurrent",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
    commercialPaperSource: {
      gaapTag: "CommercialPaper",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
  });
  assert.ok(resolved);
  assert.equal(resolved.totalDebt, 84_340_000_000);
  assert.equal(resolved.longTermDebt, 71_340_000_000);
  assert.equal(resolved.method, "noncurrent_plus_current_plus_cp");
  assert.equal(resolved.components.length, 3);
});

test("total debt: aggregate LongTermDebt does not add current term again", () => {
  const resolved = resolveTotalDebt({
    longTermDebt: 82_350_000_000,
    currentDebt: 11_010_000_000,
    commercialPaper: 1_990_000_000,
    longTermSource: {
      gaapTag: "LongTermDebt",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
    currentSource: {
      gaapTag: "LongTermDebtCurrent",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
    commercialPaperSource: {
      gaapTag: "CommercialPaper",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
  });
  assert.ok(resolved);
  // 82.35 + 1.99 CP — current term already inside aggregate
  assert.equal(resolved.totalDebt, 84_340_000_000);
  assert.equal(resolved.method, "aggregate_term_plus_other");
  assert.ok(!resolved.components.some((c) => c.role === "current_term"));
});

test("total debt ignores footnote notes carrying amount sources", () => {
  const resolved = resolveTotalDebt({
    longTermDebt: 82_300_000_000,
    currentDebt: 11_010_000_000,
    commercialPaper: null,
    longTermSource: {
      gaapTag: "DebtInstrumentCarryingAmount",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
    currentSource: {
      gaapTag: "LongTermDebtCurrent",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
  });
  assert.ok(resolved);
  // Footnote LT dropped; only current remains
  assert.equal(resolved.totalDebt, 11_010_000_000);
});

test("total debt: only noncurrent", () => {
  const resolved = resolveTotalDebt({
    longTermDebt: 50_000_000_000,
    currentDebt: null,
    commercialPaper: null,
    longTermSource: {
      gaapTag: "LongTermDebtNoncurrent",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
  });
  assert.ok(resolved);
  assert.equal(resolved.totalDebt, 50_000_000_000);
  assert.equal(resolved.longTermDebt, 50_000_000_000);
});

test("total debt: only current", () => {
  const resolved = resolveTotalDebt({
    longTermDebt: null,
    currentDebt: 5_000_000_000,
    commercialPaper: null,
    currentSource: {
      gaapTag: "ShortTermBorrowings",
      namespace: "us-gaap",
      accn: "a",
      filed: "2026-08-01",
      form: "10-Q",
    },
  });
  assert.ok(resolved);
  assert.equal(resolved.totalDebt, 5_000_000_000);
});

test("refineLongTermDebtMetric derives noncurrent from aggregate − current", () => {
  const row: FinancialPeriodRow = {
    end: "2026-06-27",
    filed: "2026-08-01",
    form: "10-Q",
    fp: "Q3",
    fy: 2026,
    accessionNumber: "a",
    metrics: {
      long_term_debt: 82_350_000_000,
      current_debt: 11_010_000_000,
      shareholder_equity: 107_520_000_000,
    },
    metricDetails: {
      long_term_debt: {
        reportedValue: 82_350_000_000,
        normalizedQuarterValue: 82_350_000_000,
        durationDays: null,
      },
    },
    metricSources: {
      long_term_debt: {
        gaapTag: "LongTermDebt",
        namespace: "us-gaap",
        accn: "a",
        filed: "2026-08-01",
        form: "10-Q",
      },
      current_debt: {
        gaapTag: "LongTermDebtCurrent",
        namespace: "us-gaap",
        accn: "a",
        filed: "2026-08-01",
        form: "10-Q",
      },
    },
    derived: {},
  };
  refineLongTermDebtMetric(row);
  assert.equal(row.metrics.long_term_debt, 71_340_000_000);
  assert.equal(row.metricSources.long_term_debt?.gaapTag, "LongTermDebtNoncurrent");
});

test("debt-to-equity uses corrected total debt and same-period equity", () => {
  const derived = computeDerivedForPeriod(
    {
      long_term_debt: 71_340_000_000,
      current_debt: 11_010_000_000,
      commercial_paper: 1_990_000_000,
      shareholder_equity: 107_520_000_000,
    },
    {
      metricSources: {
        long_term_debt: {
          gaapTag: "LongTermDebtNoncurrent",
          namespace: "us-gaap",
          accn: "a",
          filed: "2026-08-01",
          form: "10-Q",
        },
        current_debt: {
          gaapTag: "LongTermDebtCurrent",
          namespace: "us-gaap",
          accn: "a",
          filed: "2026-08-01",
          form: "10-Q",
        },
        commercial_paper: {
          gaapTag: "CommercialPaper",
          namespace: "us-gaap",
          accn: "a",
          filed: "2026-08-01",
          form: "10-Q",
        },
      },
    }
  );
  assert.equal(derived.total_debt, 84_340_000_000);
  assert.equal(derived.debt_to_equity, 0.78);
});

function instant(
  end: string,
  val: number,
  fp: string,
  form: string,
  filed: string,
  accn: string,
  fy = 2026
) {
  return { end, val, fy, fp, form, filed, accn };
}

test("extractFinancials: prefers Noncurrent over aggregate; footnotes stay separate", () => {
  const facts: SecCompanyFacts = {
    cik: "0000000001",
    facts: {
      "us-gaap": {
        Assets: {
          units: {
            USD: [instant("2026-06-27", 300e9, "Q3", "10-Q", "2026-08-01", "accn-q3")],
          },
        },
        StockholdersEquity: {
          units: {
            USD: [instant("2026-06-27", 107.52e9, "Q3", "10-Q", "2026-08-01", "accn-q3")],
          },
        },
        LongTermDebtNoncurrent: {
          units: {
            USD: [instant("2026-06-27", 71.34e9, "Q3", "10-Q", "2026-08-01", "accn-q3")],
          },
        },
        LongTermDebt: {
          units: {
            USD: [instant("2026-06-27", 82.35e9, "Q3", "10-Q", "2026-08-01", "accn-q3")],
          },
        },
        LongTermDebtCurrent: {
          units: {
            USD: [instant("2026-06-27", 11.01e9, "Q3", "10-Q", "2026-08-01", "accn-q3")],
          },
        },
        CommercialPaper: {
          units: {
            USD: [instant("2026-06-27", 1.99e9, "Q3", "10-Q", "2026-08-01", "accn-q3")],
          },
        },
        DebtInstrumentCarryingAmount: {
          units: {
            USD: [instant("2026-06-27", 82.3e9, "Q3", "10-Q", "2026-08-01", "accn-q3")],
          },
        },
        Revenues: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2026-03-29",
                val: 90e9,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "accn-q3",
              },
            ],
          },
        },
      },
    },
  };

  const { quarterly, statements } = extractFinancialsFromCompanyFacts(facts);
  const q3 = quarterly.find((r) => r.fp === "Q3" && r.end === "2026-06-27");
  assert.ok(q3);
  assert.equal(q3.metrics.long_term_debt, 71.34e9);
  assert.equal(q3.metricSources.long_term_debt?.gaapTag, "LongTermDebtNoncurrent");
  assert.equal(q3.metrics.notes_carrying_amount, 82.3e9);
  assert.equal(q3.metricSources.notes_carrying_amount?.gaapTag, "DebtInstrumentCarryingAmount");
  assert.equal(q3.derived.total_debt, 84.34e9);
  assert.equal(q3.derived.debt_to_equity, 0.78);
  assert.equal(q3.totalDebtProvenance?.components.length, 3);
  assert.equal(statements.balanceSheet.latest.long_term_debt?.value, 71.34e9);
  assert.equal(statements.balanceSheet.latest.notes_carrying_amount?.value, 82.3e9);
});

test("extractFinancials: aggregate-only term debt plus short-term borrowings", () => {
  const facts: SecCompanyFacts = {
    cik: "0000000002",
    facts: {
      "us-gaap": {
        Assets: {
          units: {
            USD: [instant("2026-06-27", 100e9, "Q3", "10-Q", "2026-08-01", "b")],
          },
        },
        StockholdersEquity: {
          units: {
            USD: [instant("2026-06-27", 40e9, "Q3", "10-Q", "2026-08-01", "b")],
          },
        },
        LongTermDebt: {
          units: {
            USD: [instant("2026-06-27", 20e9, "Q3", "10-Q", "2026-08-01", "b")],
          },
        },
        ShortTermBorrowings: {
          units: {
            USD: [instant("2026-06-27", 3e9, "Q3", "10-Q", "2026-08-01", "b")],
          },
        },
        Revenues: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2026-03-29",
                val: 10e9,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "b",
              },
            ],
          },
        },
      },
    },
  };

  const { quarterly } = extractFinancialsFromCompanyFacts(facts);
  const q3 = quarterly.find((r) => r.end === "2026-06-27");
  assert.ok(q3);
  // No current-term child: LongTermDebt stays as mapped long-term; current_debt = STB.
  // Aggregate + short-term borrowings.
  assert.equal(q3.metrics.long_term_debt, 20e9);
  assert.equal(q3.metrics.current_debt, 3e9);
  assert.equal(q3.derived.total_debt, 23e9);
});
