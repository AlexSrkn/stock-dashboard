/**
 * Curated institutional 13F filers for bulk SEC ingestion.
 * CIKs verified via data.sec.gov/submissions (13F-HR on file).
 */

export type InstitutionalManagerType =
  | "hedge_fund"
  | "asset_manager"
  | "quant"
  | "activist";

export interface Institutional13FManager {
  name: string;
  /** SEC CIK (no leading zeros). Null only when not yet verified. */
  cik: string | null;
  type: InstitutionalManagerType;
}

export const INSTITUTIONAL_13F_MANAGERS: readonly Institutional13FManager[] = [
  // --- Tier 0: Flagship value (default ingest filer) ---
  { name: "Berkshire Hathaway Inc", cik: "1067983", type: "asset_manager" },

  // --- Tier 1: Mega Asset Managers ---
  { name: "BlackRock, Inc.", cik: "2012383", type: "asset_manager" },
  { name: "Vanguard Group Inc", cik: "102909", type: "asset_manager" },
  { name: "State Street Corp", cik: "93751", type: "asset_manager" },
  { name: "FMR LLC", cik: "315066", type: "asset_manager" },
  { name: "T. Rowe Price Associates Inc", cik: "80255", type: "asset_manager" },
  { name: "Northern Trust Corp", cik: "73124", type: "asset_manager" },
  { name: "JPMorgan Chase & Co", cik: "19617", type: "asset_manager" },
  { name: "Morgan Stanley", cik: "895421", type: "asset_manager" },
  { name: "Goldman Sachs Group Inc", cik: "886982", type: "asset_manager" },
  {
    name: "UBS Asset Management Americas LLC",
    cik: "861177",
    type: "asset_manager",
  },
  { name: "Bank of New York Mellon Corp", cik: "1390777", type: "asset_manager" },
  {
    name: "Charles Schwab Investment Management Inc",
    cik: "884546",
    type: "asset_manager",
  },

  // --- Tier 2: Large Hedge Funds / Multi-strategy ---
  { name: "Bridgewater Associates, LP", cik: "1350694", type: "hedge_fund" },
  { name: "Renaissance Technologies LLC", cik: "1037389", type: "quant" },
  { name: "Citadel Advisors LLC", cik: "1423053", type: "hedge_fund" },
  { name: "Point72 Asset Management, L.P.", cik: "1603466", type: "hedge_fund" },
  { name: "D. E. Shaw & Co., Inc.", cik: "1009207", type: "quant" },
  { name: "Two Sigma Investments, LP", cik: "1179392", type: "quant" },
  { name: "AQR Capital Management LLC", cik: "1167557", type: "quant" },
  { name: "Millennium Management LLC", cik: "1273087", type: "hedge_fund" },
  { name: "Balyasny Asset Management L.P.", cik: "1218710", type: "hedge_fund" },
  { name: "Marshall Wace, LLP", cik: "1318757", type: "hedge_fund" },

  // --- Tier 3: Activist / Event Driven ---
  // Through Q1 2026 holdings were on Capital Management (1336528). From Q2 2026
  // that CIK files 13F-NT only; the consolidated 13F-HR is Pershing Square Inc.
  {
    name: "Pershing Square Capital Management, L.P.",
    cik: "1336528",
    type: "activist",
  },
  {
    name: "Pershing Square Inc.",
    cik: "2026053",
    type: "activist",
  },
  { name: "Third Point LLC", cik: "1040273", type: "activist" },
  { name: "Elliott Investment Management L.P.", cik: "1791786", type: "activist" },
  // 13F-HR filer is Carl C. Icahn (not Icahn Enterprises LP, CIK 813762).
  { name: "Icahn Enterprises", cik: "921669", type: "activist" },
  { name: "Greenlight Capital Inc", cik: "1079114", type: "activist" },
  { name: "Tiger Global Management LLC", cik: "1167483", type: "hedge_fund" },
  { name: "Coatue Management LLC", cik: "1135730", type: "hedge_fund" },
  { name: "D1 Capital Partners L.P.", cik: "1747057", type: "hedge_fund" },
  { name: "Altimeter Capital Management, LP", cik: "1541617", type: "hedge_fund" },
  { name: "Appaloosa Management LP", cik: "1006438", type: "activist" },

  // --- Tier 4: New Gen / Narrative Smart Money ---
  { name: "Scion Asset Management, LLC", cik: "1649339", type: "hedge_fund" },
  { name: "ARK Investment Management LLC", cik: "1697748", type: "asset_manager" },
  { name: "Soros Fund Management LLC", cik: "1029160", type: "hedge_fund" },
  { name: "Verition Fund Management LLC", cik: "1454027", type: "hedge_fund" },
  { name: "Hudson Bay Capital Management LP", cik: "1393825", type: "hedge_fund" },
  { name: "Sachem Head Capital Management LP", cik: "1582090", type: "activist" },
] as const;
