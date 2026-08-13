import test from "node:test";
import assert from "node:assert/strict";
import {
  chronologicalQuarterRows,
  computeQuarterRoe,
  computeTtmRoa,
  computeTtmRoe,
  resolveReturnMetricsForRow,
  selectTtmIncomeQuarters,
} from "./returnMetrics.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import type { FinancialPeriodRow, SecCompanyFacts } from "./types.js";

function qRow(
  end: string,
  fp: string,
  fy: number,
  netIncome: number,
  equity: number,
  assets: number,
  revenue = netIncome * 4
): FinancialPeriodRow {
  return {
    end,
    filed: end,
    form: "10-Q",
    fp,
    fy,
    accessionNumber: `${fy}-${fp}`,
    metrics: {
      net_income: netIncome,
      shareholder_equity: equity,
      total_assets: assets,
      revenue,
    },
    metricDetails: {},
    metricSources: {
      net_income: {
        gaapTag: "NetIncomeLoss",
        namespace: "us-gaap",
        accn: `${fy}-${fp}`,
        filed: end,
        form: "10-Q",
      },
      shareholder_equity: {
        gaapTag: "StockholdersEquity",
        namespace: "us-gaap",
        accn: `${fy}-${fp}`,
        filed: end,
        form: "10-Q",
      },
      total_assets: {
        gaapTag: "Assets",
        namespace: "us-gaap",
        accn: `${fy}-${fp}`,
        filed: end,
        form: "10-Q",
      },
    },
    derived: {},
  };
}

/** Apple-like Sept fiscal year: Q1 ends Dec, Q2 Mar, Q3 Jun, Q4 Sep. */
const appleLikeQuarters: FinancialPeriodRow[] = [
  qRow("2025-06-28", "Q3", 2025, 20e9, 90e9, 300e9), // beginning BS for TTM
  qRow("2025-09-27", "Q4", 2025, 25e9, 95e9, 310e9),
  qRow("2025-12-27", "Q1", 2026, 30e9, 100e9, 320e9),
  qRow("2026-03-28", "Q2", 2026, 28e9, 104e9, 330e9),
  qRow("2026-06-27", "Q3", 2026, 30e9, 107.52e9, 340e9),
];

test("selectTtmIncomeQuarters uses latest four fiscal quarters by period end", () => {
  const ordered = chronologicalQuarterRows(appleLikeQuarters);
  const current = appleLikeQuarters[4]!;
  const ttm = selectTtmIncomeQuarters(ordered, current);
  assert.ok(ttm);
  assert.deepEqual(
    ttm.map((r) => r.end),
    ["2025-09-27", "2025-12-27", "2026-03-28", "2026-06-27"]
  );
});

test("TTM ROE uses four quarters NI / average equity (not Q3/ending only)", () => {
  const ordered = chronologicalQuarterRows(appleLikeQuarters);
  const current = appleLikeQuarters[4]!;
  const roe = computeTtmRoe(ordered, current);
  assert.ok(roe);
  assert.equal(roe.basis, "ttm");
  assert.equal(roe.periodLabel, "TTM");
  // NI = 25+30+28+30 = 113B; avg equity = (90 + 107.52)/2 = 98.76; ROE ≈ 114.4%
  assert.equal(roe.numerator, 113e9);
  assert.equal(roe.denominator, 98.76e9);
  assert.equal(roe.value, 114.4);
  assert.equal(roe.incomeQuarters?.length, 4);
  assert.equal(roe.beginningBalance?.end, "2025-06-28");
  assert.equal(roe.endingBalance?.end, "2026-06-27");
});

test("TTM ROA uses average assets surrounding TTM window", () => {
  const ordered = chronologicalQuarterRows(appleLikeQuarters);
  const current = appleLikeQuarters[4]!;
  const roa = computeTtmRoa(ordered, current);
  assert.ok(roa);
  assert.equal(roa.basis, "ttm");
  // avg assets = (300 + 340)/2 = 320; 113/320 = 35.3%
  assert.equal(roa.denominator, 320e9);
  assert.equal(roa.value, 35.3);
});

test("single-quarter ROE is explicitly labeled with fiscal period", () => {
  const q = computeQuarterRoe(appleLikeQuarters[4]!);
  assert.ok(q);
  assert.equal(q.basis, "quarter");
  assert.equal(q.periodLabel, "Q3");
  // 30 / 107.52 ≈ 27.9% — must never be shown as unlabeled ROE
  assert.equal(q.value, 27.9);
});

test("resolveReturnMetrics prefers TTM over quarterly", () => {
  const current = appleLikeQuarters[4]!;
  const resolved = resolveReturnMetricsForRow(current, appleLikeQuarters, [], "quarterly");
  assert.equal(resolved.roe?.basis, "ttm");
  assert.equal(resolved.roa?.basis, "ttm");
  assert.equal(resolved.asset_turnover?.basis, "ttm");
});

test("calendar fiscal year company still selects by period end", () => {
  const cal: FinancialPeriodRow[] = [
    qRow("2024-12-31", "Q4", 2024, 10e9, 50e9, 200e9),
    qRow("2025-03-31", "Q1", 2025, 11e9, 52e9, 205e9),
    qRow("2025-06-30", "Q2", 2025, 12e9, 54e9, 210e9),
    qRow("2025-09-30", "Q3", 2025, 13e9, 56e9, 215e9),
    qRow("2025-12-31", "Q4", 2025, 14e9, 58e9, 220e9),
  ];
  const ordered = chronologicalQuarterRows(cal);
  const ttm = selectTtmIncomeQuarters(ordered, cal[4]!);
  assert.ok(ttm);
  assert.equal(ttm[0]!.fp, "Q1");
  assert.equal(ttm[3]!.fp, "Q4");
  const roe = computeTtmRoe(ordered, cal[4]!);
  assert.ok(roe);
  assert.equal(roe.beginningBalance?.end, "2024-12-31");
  assert.equal(roe.numerator, 50e9);
});

test("without TTM history, falls back to labeled quarter (not silent annualized)", () => {
  const onlyTwo = appleLikeQuarters.slice(3);
  const resolved = resolveReturnMetricsForRow(onlyTwo[1]!, onlyTwo, [], "quarterly");
  assert.equal(resolved.roe?.basis, "quarter");
  assert.equal(resolved.roe?.periodLabel, "Q3");
});

function instant(end: string, val: number, fp: string, fy: number, accn: string) {
  return { end, val, fy, fp, form: "10-Q", filed: end, accn };
}

function duration(
  end: string,
  start: string,
  val: number,
  fp: string,
  fy: number,
  accn: string
) {
  return { end, start, val, fy, fp, form: "10-Q", filed: end, accn };
}

test("extractFinancials labels ROE/ROA as TTM when history exists", () => {
  const periods = [
    { end: "2025-06-28", start: "2025-03-30", fp: "Q3", fy: 2025, ni: 20e9, eq: 90e9, assets: 300e9 },
    { end: "2025-12-27", start: "2025-09-28", fp: "Q1", fy: 2026, ni: 30e9, eq: 100e9, assets: 320e9 },
    { end: "2026-03-28", start: "2025-12-28", fp: "Q2", fy: 2026, ni: 28e9, eq: 104e9, assets: 330e9 },
    { end: "2026-06-27", start: "2026-03-29", fp: "Q3", fy: 2026, ni: 30e9, eq: 107.52e9, assets: 340e9 },
  ];
  // FY2025 supplies synthesized Q4 (end 2025-09-27): NI = 95 − (Q1+Q2+Q3 of FY2025).
  // We only have Q3 FY2025 in the 10-Q list above, so also include Q1+Q2 FY2025 for synthesis.
  const fy2025Extras = [
    { end: "2024-12-28", start: "2024-09-29", fp: "Q1", fy: 2025, ni: 22e9, eq: 85e9, assets: 290e9 },
    { end: "2025-03-29", start: "2024-12-29", fp: "Q2", fy: 2025, ni: 28e9, eq: 88e9, assets: 295e9 },
  ];
  const allQ = [...fy2025Extras, ...periods];

  const revenues: ReturnType<typeof duration>[] = [];
  const nis: ReturnType<typeof duration>[] = [];
  const equity: ReturnType<typeof instant>[] = [];
  const assets: ReturnType<typeof instant>[] = [];
  for (const p of allQ) {
    const accn = `${p.fy}-${p.fp}`;
    revenues.push(duration(p.end, p.start, p.ni * 3, p.fp, p.fy, accn));
    nis.push(duration(p.end, p.start, p.ni, p.fp, p.fy, accn));
    equity.push(instant(p.end, p.eq, p.fp, p.fy, accn));
    assets.push(instant(p.end, p.assets, p.fp, p.fy, accn));
  }

  const facts: SecCompanyFacts = {
    cik: "0000999999",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              ...revenues,
              {
                end: "2025-09-27",
                start: "2024-09-29",
                val: 22e9 + 28e9 + 20e9 + 25e9,
                fy: 2025,
                fp: "FY",
                form: "10-K",
                filed: "2025-11-01",
                accn: "fy-2025",
              },
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              ...nis,
              {
                end: "2025-09-27",
                start: "2024-09-29",
                val: 22e9 + 28e9 + 20e9 + 25e9,
                fy: 2025,
                fp: "FY",
                form: "10-K",
                filed: "2025-11-01",
                accn: "fy-2025",
              },
            ],
          },
        },
        StockholdersEquity: {
          units: {
            USD: [
              ...equity,
              {
                end: "2025-09-27",
                val: 95e9,
                fy: 2025,
                fp: "FY",
                form: "10-K",
                filed: "2025-11-01",
                accn: "fy-2025",
              },
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              ...assets,
              {
                end: "2025-09-27",
                val: 310e9,
                fy: 2025,
                fp: "FY",
                form: "10-K",
                filed: "2025-11-01",
                accn: "fy-2025",
              },
            ],
          },
        },
      },
    },
  };

  const { quarterly } = extractFinancialsFromCompanyFacts(facts);
  const latest = quarterly.find((r) => r.end === "2026-06-27");
  assert.ok(latest);
  assert.equal(latest.returnMetricsProvenance?.roe?.basis, "ttm");
  assert.equal(latest.returnMetricsProvenance?.roa?.basis, "ttm");
  assert.equal(latest.returnMetricsProvenance?.roe?.periodLabel, "TTM");
  // Must not equal single-quarter 30/107.52
  assert.notEqual(latest.derived.roe, 27.9);
  // TTM NI = Q4'25(25)+Q1(30)+Q2(28)+Q3(30) = 113; avg eq (90+107.52)/2
  assert.equal(latest.derived.roe, 114.4);
});
