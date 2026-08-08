import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectPoliticianFirstTimeBuys, type RawPoliticianBuy } from "./detect.js";

function buy(
  politicianKey: string,
  ticker: string,
  date: string,
  dateMs: number
): RawPoliticianBuy {
  return {
    politicianKey,
    politicianName: politicianKey,
    chamber: "house",
    state: "TX",
    party: null,
    ticker,
    assetName: null,
    transactionDate: date,
    disclosureDate: date,
    dateMs,
    estimatedValue: 1000,
  };
}

describe("politician first-time buyer detection", () => {
  it("flags first buy and returning buy after gap", () => {
    const ms2020 = Date.UTC(2020, 0, 15);
    const ms2024 = Date.UTC(2024, 0, 15);
    const rows = detectPoliticianFirstTimeBuys(
      [
        buy("alice", "AAPL", "2020-01-15", ms2020),
        buy("alice", "AAPL", "2024-01-15", ms2024),
      ],
      3
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].firstRecordedPurchase, true);
    assert.equal(rows[1].firstRecordedPurchase, false);
    assert.ok((rows[1].yearsSinceLastBuy ?? 0) >= 3);
  });

  it("skips buys within gap threshold", () => {
    const ms2020 = Date.UTC(2020, 0, 15);
    const ms2021 = Date.UTC(2021, 0, 15);
    const rows = detectPoliticianFirstTimeBuys(
      [buy("bob", "MSFT", "2020-01-15", ms2020), buy("bob", "MSFT", "2021-01-15", ms2021)],
      3
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].firstRecordedPurchase, true);
  });
});
