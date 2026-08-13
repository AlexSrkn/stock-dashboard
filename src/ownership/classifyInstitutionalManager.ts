import type { InstitutionalManagerType } from "../sec/seed/institutional-ciks.js";

/**
 * Infer hub strategy category (asset_manager | hedge_fund | quant | activist)
 * from a 13F manager display name.
 *
 * Order: activist → quant → strong traditional AM → hedge naming → soft AM → default.
 */
export function inferInstitutionalManagerType(name: string): InstitutionalManagerType {
  const n = name.trim();
  if (!n) return "hedge_fund";

  if (ACTIVIST_RE.test(n)) return "activist";
  if (QUANT_RE.test(n)) return "quant";
  if (STRONG_ASSET_MANAGER_RE.test(n)) return "asset_manager";
  if (HEDGE_HINT_RE.test(n)) return "hedge_fund";
  if (SOFT_ASSET_MANAGER_RE.test(n)) return "asset_manager";

  // Remaining entity suffixes without clear HF markers → advisory / RIA-like.
  if (/\b(llc|l\.?l\.?c\.?|inc\.?|ltd\.?|corp\.?|company|co\.)\b/i.test(n)) {
    return "asset_manager";
  }

  return "hedge_fund";
}

const ACTIVIST_RE =
  /\b(activist|13d\s+management|icahn|pershing\s*square|elliott(\s+management|\s+investment)?|third\s*point|valueact|jana(\s+partners)?|trian(\s+fund)?|sachem(\s+head)?|starboard|engaged\s+capital|ancora(\s+advisors)?|legion\s+partners|mantle\s+ridge|land\s+&\s*buildings|greenlight(\s+capital)?|oasis\s+management|cevian|bluebell|22nw)\b/i;

const QUANT_RE =
  /\b(quant(itative)?|systematic|algorithmic|stat(\.|istical)?\s*arb|machine\s*learning|two\s*sigma|renaissance(\s+technologies)?|aqr(\s+capital)?|d\.?\s*e\.?\s*shaw|worldquant|jump\s*trading|tower\s*research|hudson\s*river\s*trading|squarepoint|man\s+ahl|winton(\s+capital)?|numeric(al)?\s*(investors|technologies)?|panagora|invesco\s+quant|quantitative\s+(strategies|investing|equity))\b/i;

/** Banks, wealth, ETFs, pensions — unambiguous long-only / traditional. */
const STRONG_ASSET_MANAGER_RE =
  /\b(wealth(\s+management)?|private\s+wealth|financial\s+(advisors?|advisers?|services)|investment\s+advis(or|er)s?|registered\s+investment|ria\b|fiduciary|trust(\s+company)?|national\s+bank|private\s+bank|brokerage|etf|index\s+fund|mutual\s+fund|pension|retirement|insurance|assurance|reinsurance|sovereign|endowment|foundation|family\s+office|vanguard|blackrock|black\s*rock|fidelity|state\s+street|invesco|t\.?\s*rowe|capital\s+group|american\s+funds|dimensional|schwab|morgan\s+stanley|goldman\s+sachs|j\.?p\.?\s*morgan|wells\s+fargo|bank\s+of\s+america|northern\s+trust|bnym|bny\s+mellon|charles\s+schwab|bank\s+of)\b/i;

/**
 * Hedge / PE-ish naming common on 13F HF filers.
 * Includes "Capital Management" / "Partners LP" which are usually funds, not RIAs.
 */
const HEDGE_HINT_RE =
  /\b(hedge\s*fund|multi[\s-]?strat|long[\s\/]?short|event[\s-]?driven|macro\s+fund|capital\s+management|fund\s+management|investment\s+management|capital\s+partners|investment\s+partners|equity\s+partners|partners(\s*,)?\s*(lp|l\.?p\.?|llc|l\.?l\.?c\.?)|capital(\s*,)?\s*(lp|l\.?p\.?))\b/i;

/** Softer advisory labels after hedge patterns have been checked. */
const SOFT_ASSET_MANAGER_RE =
  /\b(asset\s*management|advisors?|advisers?|advisory)\b/i;
