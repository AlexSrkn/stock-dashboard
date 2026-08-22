import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIssuerName, slugFromNormalizedName } from "../issuers/normalize.js";
import { rankSixKFinancialExhibits } from "../sec/financials/sixK/findFinancialExhibit.js";
import { mapInlineFactsToMetrics, parseInlineXbrl } from "../sec/financials/sixK/parseInlineXbrl.js";

test("normalizeIssuerName groups Rio Tinto PLC and Ltd", () => {
  const plc = normalizeIssuerName("RIO TINTO PLC");
  const ltd = normalizeIssuerName("RIO TINTO LTD");
  assert.equal(plc, ltd);
  assert.equal(slugFromNormalizedName(plc), "rio-tinto");
});

test("rankSixKFinancialExhibits prefers ex99 financial attachments", () => {
  const ranked = rankSixKFinancialExhibits([
    { name: "cover.jpg", description: "Cover image" },
    { name: "ex99d1.htm", description: "EX-99 Financial Results" },
    { name: "rio-20260630.htm", description: "6-K" },
  ]);
  assert.equal(ranked[0]?.documentName, "ex99d1.htm");
});

test("parseInlineXbrl extracts IFRS revenue from exhibit HTML", () => {
  const html = `
    <xbrli:context id="c1"><xbrli:period>
      <xbrli:startDate>2026-01-01</xbrli:startDate>
      <xbrli:endDate>2026-06-30</xbrli:endDate>
    </xbrli:period></xbrli:context>
    <ix:nonFraction name="ifrs-full:Revenue" contextRef="c1" unitRef="usd" scale="6" decimals="-6">26873</ix:nonFraction>
    <ix:nonFraction name="ifrs-full:ProfitLoss" contextRef="c1" unitRef="usd" scale="6" decimals="-6">8500</ix:nonFraction>
  `;
  const parsed = parseInlineXbrl(html);
  const mapped = mapInlineFactsToMetrics(parsed);
  const metrics = mapped.get("c1");
  assert.equal(metrics?.revenue?.value, 26_873_000_000);
  assert.equal(metrics?.net_income?.value, 8_500_000_000);
});
