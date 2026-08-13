import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeManagersExact,
  parseLatestFilingDateFromManagerPage,
  parseManagersDirectoryPage,
} from "./parseDirectory.js";
import { isQuarterAtLeast, parseFilingQuarter } from "./quarter.js";

describe("parseFilingQuarter", () => {
  it("parses Qn YYYY and YYYY-Qn", () => {
    assert.equal(parseFilingQuarter("Q1 2026")?.key, "2026-Q1");
    assert.equal(parseFilingQuarter("2026-Q2")?.key, "2026-Q2");
    assert.equal(parseFilingQuarter("slug-q3-2025")?.key, "2025-Q3");
  });

  it("compares inclusive minimum quarter", () => {
    assert.equal(isQuarterAtLeast("2026-Q1", "2026-Q1"), true);
    assert.equal(isQuarterAtLeast("Q2 2026", "2026-Q1"), true);
    assert.equal(isQuarterAtLeast("Q4 2025", "2026-Q1"), false);
    assert.equal(isQuarterAtLeast("Q1 2024", "2026-Q1"), false);
    assert.equal(isQuarterAtLeast(null, "2026-Q1"), false);
  });
});

describe("parseManagersDirectoryPage", () => {
  const sample = `
    <table>
      <tr class="bg-gray-50 even:bg-white">
        <td class="px-2 py-2 sm:py-1 max-w-xs"><a href="/manager/0001540358-a16z-capital-management-l-l-c">a16z Capital Management, L.L.C.</a></td>
        <td class="px-2 py-2 sm:py-1 max-w-xs">Menlo Park, CA</td>
        <td class="px-2 py-2 sm:py-1 text-center">
            <a href="/13f/000154035826000006-a16z-capital-management-l-l-c-q1-2026">Q1 2026</a>
        </td>
      </tr>
      <tr class="bg-gray-50 even:bg-white">
        <td class="px-2 py-2 sm:py-1 max-w-xs"><a href="/manager/0000898427-axa-s-a">AXA S.A.</a></td>
        <td class="px-2 py-2 sm:py-1 max-w-xs">Paris, France</td>
        <td class="px-2 py-2 sm:py-1 text-center">
            <a href="/13f/000182663525000006-axa-investment-managers-s-a-q3-2025">Q3 2025</a>
        </td>
      </tr>
      <tr class="bg-gray-50 even:bg-white">
        <td class="px-2 py-2 sm:py-1 max-w-xs"><a href="/manager/0001540358-a16z-capital-management-l-l-c">a16z Capital Management, L.L.C.</a></td>
        <td class="px-2 py-2 sm:py-1 max-w-xs">Menlo Park, CA</td>
        <td class="px-2 py-2 sm:py-1 text-center">
            <a href="/13f/000154035826000006-a16z-capital-management-l-l-c-q1-2026">Q1 2026</a>
        </td>
      </tr>
    </table>
  `;

  it("extracts exact names, locations, quarters", () => {
    const rows = parseManagersDirectoryPage(sample, { letter: "a" });
    assert.equal(rows.length, 3);
    assert.equal(rows[0].manager_name, "a16z Capital Management, L.L.C.");
    assert.equal(rows[0].location, "Menlo Park, CA");
    assert.equal(rows[0].latest_filing_quarter, "2026-Q1");
    assert.equal(rows[0].source, "13f.info");
    assert.match(rows[0].source_url, /\/manager\/0001540358-a16z-capital-management-l-l-c$/);
    assert.equal(rows[1].latest_filing_quarter, "2025-Q3");
  });

  it("dedupes exact id duplicates only", () => {
    const rows = parseManagersDirectoryPage(sample, { letter: "a" });
    const { unique, duplicatesRemoved } = dedupeManagersExact(rows);
    assert.equal(unique.length, 2);
    assert.equal(duplicatesRemoved, 1);
    assert.equal(unique[0].manager_name, "a16z Capital Management, L.L.C.");
    assert.equal(unique[1].manager_name, "AXA S.A.");
  });
});

describe("parseLatestFilingDateFromManagerPage", () => {
  it("reads date filed from first filings row", () => {
    const html = `
      <th>Date Filed</th>
      <tbody class="font-mono">
        <tr>
          <td data-order="2026-03-31"><a>Q1 2026</a></td>
          <td data-order="2026-05-15">5/15/2026</td>
        </tr>
      </tbody>
    `;
    assert.equal(parseLatestFilingDateFromManagerPage(html), "2026-05-15");
  });
});
