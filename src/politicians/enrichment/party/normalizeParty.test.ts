import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeParty } from "./normalizeParty.js";

describe("normalizeParty abbreviations", () => {
  it("handles Libertarian", () => {
    assert.equal(normalizeParty("Libertarian"), "Libertarian");
    assert.equal(normalizeParty("L"), "Libertarian");
  });
});
