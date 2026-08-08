import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  booleanSimilarity,
  buildMatchReasons,
  minMaxNormalize,
  numericSimilarity,
  scoreHolderOverlap,
  scoreInstitutionalProfile,
  weightedSimilarityScore,
  type ProfileMetrics,
} from "./score.js";

function profile(over: Partial<ProfileMetrics> = {}): ProfileMetrics {
  return {
    ownershipPct: 60,
    holderCount: 1000,
    holderGrowthPct: 10,
    discoveryScore: 80,
    newHolderCount: 50,
    exitedHolderCount: 20,
    netHolderChange: 30,
    ownershipChangePct: 2,
    convictionScore: 70,
    insiderSentiment: 65,
    clusterBuying: true,
    heavySelling: false,
    repeatBuyers: true,
    politicianHeavyBuying: false,
    politicianHeavySelling: false,
    politicianRepeatBuyers: false,
    politicianFirstTimeBuyers: false,
    doubleSignal: true,
    tripleSignal: false,
    hiddenGem: false,
    conflictSignal: false,
    hasInsiderActivity: true,
    hasPoliticianActivity: false,
    hasActiveSignals: true,
    ...over,
  };
}

describe("numericSimilarity", () => {
  it("returns 100 for identical values", () => {
    assert.equal(numericSimilarity(50, 50), 100);
  });

  it("returns null for missing values", () => {
    assert.equal(numericSimilarity(null, 10), null);
  });
});

describe("booleanSimilarity", () => {
  it("matches identical booleans", () => {
    assert.equal(booleanSimilarity(true, true), 100);
    assert.equal(booleanSimilarity(false, true), 0);
  });
});

describe("minMaxNormalize", () => {
  it("maps min to 0 and max to 100", () => {
    assert.equal(minMaxNormalize(0, 0, 10), 0);
    assert.equal(minMaxNormalize(10, 0, 10), 100);
    assert.equal(minMaxNormalize(5, 0, 10), 50);
  });
});

describe("scoreHolderOverlap", () => {
  it("blends overlap percentage and weighted score", () => {
    const score = scoreHolderOverlap({
      overlapPercentage: 80,
      normalizedWeightedScore: 60,
    });
    assert.ok(score > 60 && score < 80);
  });
});

describe("weightedSimilarityScore", () => {
  it("applies component weights", () => {
    const score = weightedSimilarityScore({
      institutional_profile: 100,
      institutional_holder_overlap: 100,
      institutional_activity: 100,
      insider_activity: 0,
      politician_activity: 0,
      signals: 0,
    });
    assert.ok(score != null && score > 70);
  });

  it("ignores missing components and renormalizes", () => {
    const score = weightedSimilarityScore({
      institutional_profile: 100,
      institutional_holder_overlap: null,
      institutional_activity: null,
      insider_activity: null,
      politician_activity: null,
      signals: null,
    });
    assert.equal(score, 100);
  });
});

describe("scoreInstitutionalProfile", () => {
  it("scores similar profiles highly", () => {
    const score = scoreInstitutionalProfile(profile(), profile({ discoveryScore: 82 }));
    assert.ok(score != null && score >= 90);
  });
});

describe("buildMatchReasons", () => {
  it("includes shared holders and discovery", () => {
    const reasons = buildMatchReasons({
      sharedHolderCount: 132,
      discoverySimilarity: 91,
      insiderSimilarity: 74,
      politicianSimilarity: 40,
      signalsSimilarity: 80,
      activitySimilarity: 70,
      matchingSignals: ["Double Signal"],
    });
    assert.ok(reasons.some((r) => r.includes("132 shared")));
    assert.ok(reasons.some((r) => r.includes("Discovery")));
  });
});
