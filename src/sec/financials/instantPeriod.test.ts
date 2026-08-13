import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import type { SecCompanyFacts } from "./types.js";

function duration(
  end: string,
  start: string,
  val: number,
  fp: string,
  fy: number,
  form: string,
  filed: string,
  accn: string
) {
  return { end, start, val, fy, fp, form, filed, accn };
}

function instant(
  end: string,
  val: number,
  fp: string,
  fy: number,
  form: string,
  filed: string,
  accn: string
) {
  return { end, val, fy, fp, form, filed, accn };
}

test("FYE instant assets belong to annual FY, not later quarterly periods", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              // FY2025 annual
              duration("2025-09-27", "2024-09-29", 416e9, "FY", 2025, "10-K", "2025-10-31", "a25"),
              // FY2026 quarters
              duration("2025-12-27", "2025-09-28", 120e9, "Q1", 2026, "10-Q", "2026-01-30", "q1"),
              duration("2026-03-28", "2025-12-28", 95e9, "Q2", 2026, "10-Q", "2026-05-02", "q2"),
              duration("2026-06-27", "2026-03-29", 90e9, "Q3", 2026, "10-Q", "2026-08-01", "q3"),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              // True FYE balance sheet
              instant("2025-09-27", 359.241e9, "FY", 2025, "10-K", "2025-10-31", "a25"),
              // Comparative FYE assets retagged with each later quarter's fp/fy (the bug)
              instant("2025-09-27", 359.241e9, "Q1", 2026, "10-Q", "2026-01-30", "q1"),
              instant("2025-09-27", 359.241e9, "Q2", 2026, "10-Q", "2026-05-02", "q2"),
              instant("2025-09-27", 359.241e9, "Q3", 2026, "10-Q", "2026-08-01", "q3"),
              // True quarter-end balance sheets
              instant("2025-12-27", 379.297e9, "Q1", 2026, "10-Q", "2026-01-30", "q1"),
              instant("2026-03-28", 371.082e9, "Q2", 2026, "10-Q", "2026-05-02", "q2"),
              instant("2026-06-27", 383.266e9, "Q3", 2026, "10-Q", "2026-08-01", "q3"),
            ],
          },
        },
      },
    },
  };

  const { annual, quarterly } = extractFinancialsFromCompanyFacts(fixture);

  const fy2025 = annual.find((r) => r.end === "2025-09-27");
  assert.equal(fy2025?.fy, 2025);
  assert.equal(fy2025?.fp, "FY");
  assert.equal(fy2025?.metrics.total_assets, 359.241e9);

  const q1 = quarterly.find((r) => r.fp === "Q1" && r.end === "2025-12-27");
  const q2 = quarterly.find((r) => r.fp === "Q2" && r.end === "2026-03-28");
  const q3 = quarterly.find((r) => r.fp === "Q3" && r.end === "2026-06-27");
  assert.ok(q1 && q2 && q3);

  assert.equal(q1.metrics.total_assets, 379.297e9);
  assert.equal(q2.metrics.total_assets, 371.082e9);
  assert.equal(q3.metrics.total_assets, 383.266e9);

  // Must not create quarterly rows keyed to the FYE instant date.
  assert.ok(!quarterly.some((r) => r.end === "2025-09-27"));
  assert.notEqual(q1.metrics.total_assets, 359.241e9);
  assert.notEqual(q2.metrics.total_assets, 359.241e9);
  assert.notEqual(q3.metrics.total_assets, 359.241e9);
});

test("missing quarter-end balance sheet stays null (no carry-forward)", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              duration("2025-12-27", "2025-09-28", 120e9, "Q1", 2026, "10-Q", "2026-01-30", "q1"),
              duration("2026-03-28", "2025-12-28", 95e9, "Q2", 2026, "10-Q", "2026-05-02", "q2"),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              instant("2025-12-27", 379e9, "Q1", 2026, "10-Q", "2026-01-30", "q1"),
              // Prior FYE comparative only — must not fill Q2
              instant("2025-09-27", 359e9, "Q2", 2026, "10-Q", "2026-05-02", "q2"),
            ],
          },
        },
      },
    },
  };

  const { quarterly } = extractFinancialsFromCompanyFacts(fixture);
  const q1 = quarterly.find((r) => r.end === "2025-12-27");
  const q2 = quarterly.find((r) => r.end === "2026-03-28");
  assert.equal(q1?.metrics.total_assets, 379e9);
  assert.equal(q2?.metrics.total_assets, undefined);
  assert.ok(q2?.metrics.revenue);
});

test("December FY company: instant binds to matching period end only", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000789019",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              duration("2024-12-31", "2024-01-01", 200e9, "FY", 2024, "10-K", "2025-02-01", "fy"),
              duration("2025-03-31", "2025-01-01", 50e9, "Q1", 2025, "10-Q", "2025-04-25", "q1"),
              duration("2025-06-30", "2025-04-01", 55e9, "Q2", 2025, "10-Q", "2025-07-25", "q2"),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              instant("2024-12-31", 500e9, "FY", 2024, "10-K", "2025-02-01", "fy"),
              instant("2024-12-31", 500e9, "Q1", 2025, "10-Q", "2025-04-25", "q1"),
              instant("2025-03-31", 510e9, "Q1", 2025, "10-Q", "2025-04-25", "q1"),
              instant("2025-06-30", 520e9, "Q2", 2025, "10-Q", "2025-07-25", "q2"),
            ],
          },
        },
      },
    },
  };

  const { annual, quarterly } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(annual.find((r) => r.end === "2024-12-31")?.metrics.total_assets, 500e9);
  assert.equal(quarterly.find((r) => r.end === "2025-03-31")?.metrics.total_assets, 510e9);
  assert.equal(quarterly.find((r) => r.end === "2025-06-30")?.metrics.total_assets, 520e9);
  assert.ok(!quarterly.some((r) => r.end === "2024-12-31"));
});

test("duration income facts still map to correct fiscal quarters", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              duration("2025-12-27", "2025-09-28", 143.756e9, "Q1", 2026, "10-Q", "2026-01-30", "q1"),
              duration("2026-03-28", "2025-12-28", 111.184e9, "Q2", 2026, "10-Q", "2026-05-02", "q2"),
              duration("2026-06-27", "2026-03-29", 109.417e9, "Q3", 2026, "10-Q", "2026-08-01", "q3"),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              instant("2025-12-27", 379e9, "Q1", 2026, "10-Q", "2026-01-30", "q1"),
              instant("2026-03-28", 371e9, "Q2", 2026, "10-Q", "2026-05-02", "q2"),
              instant("2026-06-27", 383e9, "Q3", 2026, "10-Q", "2026-08-01", "q3"),
            ],
          },
        },
      },
    },
  };

  const { quarterly } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(quarterly.find((r) => r.fp === "Q1")?.metrics.revenue, 143.756e9);
  assert.equal(quarterly.find((r) => r.fp === "Q2")?.metrics.revenue, 111.184e9);
  assert.equal(quarterly.find((r) => r.fp === "Q3")?.metrics.revenue, 109.417e9);
});
