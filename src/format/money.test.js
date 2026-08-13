import test from "node:test";
import assert from "node:assert/strict";
import { formatSignedUsdCompact, formatUsdMillionsCompact } from "./money.js";

test("formatSignedUsdCompact formats billions from raw dollars", () => {
  assert.equal(formatSignedUsdCompact(10_014_229_000), "+$10.01B");
  assert.equal(formatSignedUsdCompact(2_646_533_000), "+$2.65B");
  assert.equal(formatSignedUsdCompact(-3_412_098_000), "−$3.41B");
});

test("formatSignedUsdCompact formats millions from raw dollars", () => {
  assert.equal(formatSignedUsdCompact(916_555_000), "+$916.55M");
  assert.equal(formatSignedUsdCompact(-1_000_000), "−$1.00M");
});

test("formatSignedUsdCompact formats thousands and small dollars", () => {
  assert.equal(formatSignedUsdCompact(12_500), "+$12.50K");
  assert.equal(formatSignedUsdCompact(42.5), "+$42.50");
  assert.equal(formatSignedUsdCompact(0), "$0");
});

test("formatSignedUsdCompact never appends M to the raw dollar integer", () => {
  const label = formatSignedUsdCompact(10_014_229);
  assert.equal(label, "+$10.01M");
  assert.ok(!label.includes("10014229"));
  assert.notEqual(formatSignedUsdCompact(10_014_229_000), "+$10014229M");
  assert.notEqual(formatSignedUsdCompact(10_014_229), "+$10014229M");
});

test("formatSignedUsdCompact handles non-finite input", () => {
  assert.equal(formatSignedUsdCompact(null), "—");
  assert.equal(formatSignedUsdCompact(Number.NaN), "—");
});

test("formatUsdMillionsCompact formats values already in USD millions", () => {
  assert.equal(formatUsdMillionsCompact(2646.53), "+$2.65B");
  assert.equal(formatUsdMillionsCompact(1028.45), "+$1.03B");
  assert.equal(formatUsdMillionsCompact(54.96), "+$54.96M");
  assert.equal(formatUsdMillionsCompact(916.56), "+$916.56M");
  assert.equal(formatUsdMillionsCompact(-3412.1), "−$3.41B");
  assert.equal(formatUsdMillionsCompact(-9471.99), "−$9.47B");
  assert.equal(formatUsdMillionsCompact(-19.65), "−$19.65M");
  assert.equal(formatUsdMillionsCompact(4.77), "+$4.77M");
});

test("Activity dollars must not be 1000x inflated (filingValueUsd regression)", () => {
  // Correct GOOGL-scale add is ~$10.47B dollars.
  assert.equal(formatSignedUsdCompact(10_468_235_319.44), "+$10.47B");
  // Inflated (*1000) dollars must not be shown as a sane ~$10B figure.
  assert.equal(formatSignedUsdCompact(10_468_235_319_440.53), "+$10468.24B");
});
