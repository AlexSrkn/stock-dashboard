import type { SecurityListingKind } from "./types.js";

export interface IssuerGroupSeed {
  slug: string;
  name: string;
  primaryTicker: string;
  primaryCik: string;
  listings: Array<{
    ticker: string;
    cik: string;
    companyName: string;
    listingKind: SecurityListingKind;
    isPrimaryFiling: boolean;
  }>;
}

/** Known multi-listing groups where SEC companyfacts live on the primary filer only. */
export const ISSUER_GROUP_SEEDS: IssuerGroupSeed[] = [
  {
    slug: "rio-tinto",
    name: "Rio Tinto Group",
    primaryTicker: "RIO",
    primaryCik: "0000863064",
    listings: [
      {
        ticker: "RIO",
        cik: "0000863064",
        companyName: "RIO TINTO PLC",
        listingKind: "adr",
        isPrimaryFiling: true,
      },
      {
        ticker: "RTPPF",
        cik: "0000863064",
        companyName: "RIO TINTO PLC",
        listingKind: "otc",
        isPrimaryFiling: false,
      },
      {
        ticker: "RTNTF",
        cik: "0000887028",
        companyName: "RIO TINTO LTD",
        listingKind: "otc",
        isPrimaryFiling: false,
      },
    ],
  },
];
