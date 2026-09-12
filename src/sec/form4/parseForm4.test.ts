import assert from "node:assert/strict";
import test from "node:test";
import { parseForm4Xml, parsePriceFromFootnoteText } from "./parseForm4.js";

test("parsePriceFromFootnoteText reads PIPE-style purchase price", () => {
  const price = parsePriceFromFootnoteText(
    "The reporting person purchased 19,455 shares. The purchase price for each share of common stock and accompanying warrant was $1.285."
  );
  assert.equal(price, 1.285);
});

test("parsePriceFromFootnoteText uses midpoint for weighted-average ranges", () => {
  const price = parsePriceFromFootnoteText(
    "The price reported in Column 4 is a weighted average price. These shares were sold in multiple transactions at prices ranging from $10.00 to $12.00."
  );
  assert.equal(price, 11);
});

test("parseForm4Xml resolves footnote-only transactionPricePerShare", () => {
  const xml = `<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0001234567</issuerCik>
    <issuerName>Test Co</issuerName>
    <issuerTradingSymbol>TNON</issuerTradingSymbol>
  </issuer>
  <periodOfReport>2025-11-14</periodOfReport>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>DOE JOHN</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common stock</value></securityTitle>
      <transactionDate><value>2025-11-14</value></transactionDate>
      <transactionCoding>
        <transactionCode>P</transactionCode>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>19455</value></transactionShares>
        <transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <footnotes>
    <footnote id="F1">The purchase price for each share of common stock and accompanying warrant was $1.285.</footnote>
  </footnotes>
</ownershipDocument>`;

  const parsed = parseForm4Xml(xml, "2025-11-15");
  assert.equal(parsed.transactions.length, 1);
  const tx = parsed.transactions[0]!;
  assert.equal(tx.transactionCode, "P");
  assert.equal(tx.shares, 19455);
  assert.equal(tx.pricePerShare, 1.285);
  assert.equal(tx.transactionValue, Math.round(19455 * 1.285 * 100) / 100);
});
