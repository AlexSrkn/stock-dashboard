import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyFinancialSixK,
  rankFinancialSixKFilings,
  shouldSupplementFromSixK,
} from "../foreignFiler.js";
import { rankSixKFinancialExhibits } from "./findFinancialExhibit.js";
import { mapFactsToMetrics, parseXbrlDocument } from "./parseXbrlDocument.js";
import type { SecFinancialFilingRow } from "../types.js";

test("isLikelyFinancialSixK prefers interim report dates", () => {
  assert.equal(
    isLikelyFinancialSixK({
      form: "6-K",
      filingDate: "2026-07-29",
      reportDate: "2026-06-30",
      accessionNumber: "x",
      primaryDocument: "rio-20260630.htm",
      description: "6-K",
    } as SecFinancialFilingRow),
    true
  );
  assert.equal(
    isLikelyFinancialSixK({
      form: "6-K",
      filingDate: "2026-08-03",
      reportDate: "2026-07-31",
      accessionNumber: "x",
      primaryDocument: "form6k2026july.htm",
      description: "6-K",
    } as SecFinancialFilingRow),
    false
  );
});

test("rankFinancialSixKFilings sorts by report date", () => {
  const ranked = rankFinancialSixKFilings([
    {
      form: "6-K",
      filingDate: "2026-08-03",
      reportDate: "2026-07-31",
      primaryDocument: "form6k2026july.htm",
    } as SecFinancialFilingRow,
    {
      form: "6-K",
      filingDate: "2026-07-29",
      reportDate: "2026-06-30",
      primaryDocument: "rio-20260630.htm",
    } as SecFinancialFilingRow,
  ]);
  assert.equal(ranked[0]?.primaryDocument, "rio-20260630.htm");
});

test("rankSixKFinancialExhibits prefers ex99 financial attachments", () => {
  const ranked = rankSixKFinancialExhibits([
    { name: "cover.jpg", description: "Cover image" },
    { name: "ex99d1.htm", description: "EX-99 Financial Results" },
    { name: "rio-20260630.htm", description: "6-K" },
  ]);
  assert.equal(ranked[0]?.documentName, "ex99d1.htm");
});

test("parseXbrlDocument extracts IFRS revenue from inline exhibit HTML", () => {
  const html = `
    <xbrli:context id="c1"><xbrli:period>
      <xbrli:startDate>2026-01-01</xbrli:startDate>
      <xbrli:endDate>2026-06-30</xbrli:endDate>
    </xbrli:period></xbrli:context>
    <ix:nonFraction name="ifrs-full:Revenue" contextRef="c1" unitRef="usd" scale="6" decimals="-6">26873</ix:nonFraction>
    <ix:nonFraction name="ifrs-full:ProfitLoss" contextRef="c1" unitRef="usd" scale="6" decimals="-6">8500</ix:nonFraction>
  `;
  const parsed = parseXbrlDocument(html);
  const mapped = mapFactsToMetrics(parsed);
  const metrics = mapped.get("c1");
  assert.equal(metrics?.revenue?.value, 26_873_000_000);
  assert.equal(metrics?.net_income?.value, 8_500_000_000);
});

test("parseXbrlDocument extracts IFRS revenue from standalone instance XML", () => {
  const xml = `
    <context id="c-1">
      <period><startDate>2026-01-01</startDate><endDate>2026-06-30</endDate></period>
    </context>
    <ifrs-full:Revenue contextRef="c-1" decimals="-6" unitRef="usd">31028000000</ifrs-full:Revenue>
    <ifrs-full:ProfitLoss contextRef="c-1" decimals="-6" unitRef="usd">8500000000</ifrs-full:ProfitLoss>
  `;
  const parsed = parseXbrlDocument(xml);
  const mapped = mapFactsToMetrics(parsed);
  const metrics = mapped.get("c-1");
  assert.equal(metrics?.revenue?.value, 31_028_000_000);
  assert.equal(metrics?.net_income?.value, 8_500_000_000);
});

test("shouldSupplementFromSixK when newer financial 6-K exists", () => {
  const submissions = {
    filings: {
      recent: { form: ["20-F", "6-K"] },
    },
  } as never;
  const companyFacts = { facts: { "ifrs-full": { Revenue: {} } } } as never;
  const quarterly = [{ end: "2025-06-30", fp: "Q2", filed: "2025-07-30" }] as never;
  const sixK = [
    {
      form: "6-K",
      filingDate: "2026-07-29",
      reportDate: "2026-06-30",
      primaryDocument: "rio-20260630.htm",
    },
  ] as never;
  assert.equal(shouldSupplementFromSixK(submissions, companyFacts, quarterly, sixK), true);
});
