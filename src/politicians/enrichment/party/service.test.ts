import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeParty } from "./normalizeParty.js";
import { namesLikelyMatch, parsePoliticianName } from "./normalizeName.js";
import {
  loadPartyRosterFixture,
  lookupPartyInRoster,
  parseLegislatorsCurrentJson,
} from "./roster.js";
import { getPoliticianParty } from "./service.js";
import { isBioguideId, politicianKey } from "../../politicianKey.js";
import { enrichPoliticiansRecent } from "../enrichRecent.js";
import type { PoliticiansRecentPayload } from "../../recent.js";

const FIXTURE = "src/politicians/enrichment/party/fixtures/legislators-sample.json";

describe("normalizeParty", () => {
  it("maps common abbreviations", () => {
    assert.equal(normalizeParty("D"), "Democrat");
    assert.equal(normalizeParty("R"), "Republican");
    assert.equal(normalizeParty("Independent"), "Independent");
  });
});

describe("parseLegislatorsCurrentJson", () => {
  it("extracts current chamber, state, and party", () => {
    const members = parseLegislatorsCurrentJson([
      {
        id: { bioguide: "B001236" },
        name: { first: "John", last: "Boozman", official_full: "John Boozman" },
        terms: [{ type: "sen", state: "AR", party: "Republican", start: "2011-01-03" }],
      },
    ]);
    assert.equal(members.length, 1);
    assert.equal(members[0]!.party, "Republican");
    assert.equal(members[0]!.chamber, "senate");
    assert.equal(members[0]!.state, "AR");
  });
});

describe("getPoliticianParty", () => {
  const roster = loadPartyRosterFixture(FIXTURE);

  it("resolves Senate Republican by bioguide", async () => {
    const hit = await getPoliticianParty("B001236", "senate", "AR", { roster });
    assert.ok(hit);
    assert.equal(hit!.party, "Republican");
    assert.equal(hit!.chamber, "Senate");
    assert.equal(hit!.state, "AR");
  });

  it("resolves House Democrat by name + state", async () => {
    const key = politicianKey("Nancy Pelosi");
    const hit = await getPoliticianParty(key, "house", "CA", {
      name: "Nancy Pelosi",
      roster,
    });
    assert.ok(hit);
    assert.equal(hit!.party, "Democrat");
    assert.equal(hit!.bioguideId, "P000197");
  });

  it("resolves Independent senator (Sanders)", async () => {
    const hit = await getPoliticianParty("S000033", "senate", "VT", { roster });
    assert.ok(hit);
    assert.equal(hit!.party, "Independent");
  });

  it("returns null for unknown politicians without throwing", async () => {
    const hit = await getPoliticianParty("not-a-real-person", "house", "ZZ", {
      name: "Totally Unknown Person",
      roster,
    });
    assert.equal(hit, null);
  });
});

describe("lookupPartyInRoster edge cases", () => {
  const roster = loadPartyRosterFixture(FIXTURE);

  it("disambiguates duplicate last names by state", () => {
    const hit = lookupPartyInRoster(roster, {
      name: "John Boozman",
      chamber: "senate",
      state: "AR",
    });
    assert.equal(hit?.party, "Republican");
  });

  it("matches honorific-stripped names", () => {
    assert.ok(namesLikelyMatch("Hon. Nancy Pelosi", "Nancy Pelosi"));
    const parsed = parsePoliticianName("Pelosi, Nancy");
    assert.equal(parsed.last, "pelosi");
    assert.equal(parsed.first, "nancy");
  });
});

describe("isBioguideId", () => {
  it("recognizes bioguide IDs", () => {
    assert.equal(isBioguideId("B001236"), true);
    assert.equal(isBioguideId("nancy-pelosi"), false);
  });
});

describe("enrichPoliticiansRecent", () => {
  it("enriches bundles and does not break when party is missing", async () => {
    const roster = loadPartyRosterFixture(FIXTURE);
    const payload: PoliticiansRecentPayload = {
      fetchedAt: new Date().toISOString(),
      limitPerChamber: 1,
      house: [
        {
          chamber: "house",
          politicianName: "Nancy Pelosi",
          filingDate: "2026-01-01",
          filingId: "x",
          sourceUrl: "",
          state: "CA",
          tradeCount: 1,
          trades: [
            {
              chamber: "house",
              politicianName: "Nancy Pelosi",
              assetName: "Apple Inc",
              ticker: "AAPL",
              assetType: "Stock",
              transactionType: "Purchase",
              transactionCategory: "buy",
              transactionDate: "2026-01-01",
              notificationDate: null,
              amountRange: "$1,001 - $15,000",
              amountMin: 1001,
              amountMax: 15000,
              capitalGainsOver200: null,
              filingDate: "2026-01-01",
              filingId: "x",
              sourceUrl: "",
            },
          ],
        },
        {
          chamber: "house",
          politicianName: "Unknown Member",
          filingDate: "2026-01-01",
          filingId: "y",
          sourceUrl: "",
          state: "TX",
          tradeCount: 0,
          trades: [],
        },
      ],
      senate: [
        {
          chamber: "senate",
          politicianName: "John Boozman",
          filingDate: "2026-01-01",
          filingId: "z",
          sourceUrl: "",
          office: "AR",
          tradeCount: 0,
          trades: [],
        },
      ],
    };

    const enriched = await enrichPoliticiansRecent(payload, {
      persistToDatabase: false,
    });

    assert.equal(enriched.house[0]!.party, "Democrat");
    assert.equal(enriched.house[0]!.trades[0]!.party, "Democrat");
    assert.equal(enriched.house[1]!.party, null);
    assert.equal(enriched.senate[0]!.party, "Republican");
  });
});
