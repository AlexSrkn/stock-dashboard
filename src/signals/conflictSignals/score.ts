import type {

  ConflictSignalInsiderRoles,

  ConflictSignalRow,

  ConflictSignalType,

} from "./types.js";



export function clampScore(n: number, min = -100, max = 100): number {

  if (!Number.isFinite(n)) return 0;

  return Math.max(min, Math.min(max, n));

}



export function round1(n: number): number {

  return Math.round(n * 10) / 10;

}



export function round2(n: number): number {

  return Math.round(n * 100) / 100;

}



export function classifyInsiderRoles(title: string | null | undefined): ConflictSignalInsiderRoles {

  const t = String(title || "");

  return {

    ceo: /\bceo\b|chief executive/i.test(t),

    cfo: /\bcfo\b|chief financial/i.test(t),

    director: /\bdirector\b|chairman|chairwoman|chair\b/i.test(t),

    officer: /\bofficer\b|\bpresident\b|\bcoo\b|\bchief\b|\bev[p]?\b|\bsvp\b/i.test(t),

  };

}



export function isCLevelTitle(title: string | null | undefined): boolean {

  const roles = classifyInsiderRoles(title);

  return roles.ceo || roles.cfo || /\bcoo\b|chief |president/i.test(String(title || ""));

}



export function mergeRoles(

  a: ConflictSignalInsiderRoles,

  b: ConflictSignalInsiderRoles

): ConflictSignalInsiderRoles {

  return {

    ceo: a.ceo || b.ceo,

    cfo: a.cfo || b.cfo,

    director: a.director || b.director,

    officer: a.officer || b.officer,

  };

}



/**

 * Institution score ∈ [-100, 100]

 * Positive = accumulation, negative = distribution.

 */

export function computeInstitutionScore(input: {

  institutionsIncreasing: number;

  institutionsReducing: number;

  newPositions: number;

  fullyExited: number;

  ownershipChangePct: number;

}): number {

  const movers = input.institutionsIncreasing + input.institutionsReducing;

  const breadth =

    movers > 0

      ? ((input.institutionsIncreasing - input.institutionsReducing) / movers) * 55

      : 0;



  const turnover = input.newPositions + input.fullyExited;

  const entryExit =

    turnover > 0 ? ((input.newPositions - input.fullyExited) / turnover) * 20 : 0;



  const magnitude = clampScore(input.ownershipChangePct * 2.5, -25, 25);

  return round1(clampScore(breadth + entryExit + magnitude));

}



/**

 * Insider score ∈ [-100, 100]

 * Positive = buying, negative = selling.

 */

export function computeInsiderScore(input: {

  buyVolumeUsd: number;

  sellVolumeUsd: number;

  uniqueBuyers: number;

  uniqueSellers: number;

}): number {

  const totalVol = input.buyVolumeUsd + input.sellVolumeUsd;

  const flow = totalVol > 0 ? ((input.buyVolumeUsd - input.sellVolumeUsd) / totalVol) * 70 : 0;



  const people = input.uniqueBuyers + input.uniqueSellers;

  const peopleSkew =

    people > 0 ? ((input.uniqueBuyers - input.uniqueSellers) / people) * 30 : 0;



  return round1(clampScore(flow + peopleSkew));

}



export function detectSignalTypes(input: {

  institutionScore: number;

  insiderScore: number;

  institutionsBuyingCount: number;

  cLevelSellers: number;

}): ConflictSignalType[] {

  const types: ConflictSignalType[] = [];

  const { institutionScore, insiderScore } = input;



  if (institutionScore > 50 && insiderScore < -30) {

    types.push("institutions_buying_insiders_selling");

  }

  if (institutionScore < -50 && insiderScore > 30) {

    types.push("institutions_selling_insiders_buying");

  }

  if (Math.abs(institutionScore - insiderScore) > 100) {

    types.push("strong_divergence");

  }

  if (

    input.institutionsBuyingCount >= 2 &&

    institutionScore > 40 &&

    input.cLevelSellers > 0 &&

    insiderScore < -20

  ) {

    types.push("double_conviction_conflict");

  }



  return types;

}



/** Prefer double conviction, then directional conflicts, then divergence. */

export function pickPrimarySignalType(types: ConflictSignalType[]): ConflictSignalType | null {

  if (types.includes("double_conviction_conflict")) return "double_conviction_conflict";

  if (types.includes("institutions_buying_insiders_selling")) {

    return "institutions_buying_insiders_selling";

  }

  if (types.includes("institutions_selling_insiders_buying")) {

    return "institutions_selling_insiders_buying";

  }

  if (types.includes("strong_divergence")) return "strong_divergence";

  return null;

}



export function conflictScore(institutionScore: number, insiderScore: number): number {

  return round1(Math.abs(institutionScore - insiderScore));

}



export function emptyInsiderRoles(): ConflictSignalInsiderRoles {

  return { ceo: false, cfo: false, director: false, officer: false };

}



export type { ConflictSignalRow };


