import test from "node:test";
import assert from "node:assert/strict";
import { issuerPatternFromTitle, isUsableCusip } from "./resolveStock.ts";

test("issuerPatternFromTitle uses two tokens for multi-word names", () => {
  assert.equal(issuerPatternFromTitle("RIO TINTO PLC"), "%RIO TINTO%");
  assert.equal(issuerPatternFromTitle("Apple Inc."), "%APPLE%");
  assert.equal(issuerPatternFromTitle("Berkshire Hathaway Inc"), "%BERKSHIRE HATHAWAY%");
});

test("isUsableCusip rejects padded placeholders", () => {
  assert.equal(isUsableCusip("000000000"), false);
  assert.equal(isUsableCusip("0"), false);
  assert.equal(isUsableCusip("000000RIO"), false);
  assert.equal(isUsableCusip("767204100"), true);
});
