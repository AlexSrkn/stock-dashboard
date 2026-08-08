import type { NormalizedParty } from "../types.js";

const PARTY_MAP: Record<string, NormalizedParty> = {
  D: "Democrat",
  DEM: "Democrat",
  DEMOCRAT: "Democrat",
  DEMOCRATIC: "Democrat",
  R: "Republican",
  REP: "Republican",
  REPUBLICAN: "Republican",
  I: "Independent",
  IND: "Independent",
  INDEPENDENT: "Independent",
  L: "Libertarian",
  LIB: "Libertarian",
  LIBERTARIAN: "Libertarian",
  G: "Green",
  GREEN: "Green",
};

export function normalizeParty(raw: string | null | undefined): NormalizedParty | null {
  const key = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!key) return null;
  if (PARTY_MAP[key]) return PARTY_MAP[key];
  const title = String(raw || "")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return title || null;
}
