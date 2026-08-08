export interface SectorIndustry {
  sector: string | null;
  industry: string | null;
}

/** Map 4-digit SIC code to a high-level sector (GICS-style labels). */
export function sectorFromSicCode(sic: number): string | null {
  if (!Number.isFinite(sic) || sic <= 0) return null;

  if (sic >= 2830 && sic <= 2839) return "Healthcare";
  if (sic >= 3840 && sic <= 3849) return "Healthcare";
  if (sic >= 8000 && sic <= 8099) return "Healthcare";

  if (sic >= 3570 && sic <= 3579) return "Technology";
  if (sic >= 3670 && sic <= 3679) return "Technology";
  if (sic >= 7370 && sic <= 7379) return "Technology";
  if (sic >= 4810 && sic <= 4819) return "Technology";
  if (sic >= 7371 && sic <= 7379) return "Technology";

  if (sic >= 6000 && sic <= 6799) return "Financials";

  if (sic >= 4900 && sic <= 4999) return "Utilities";
  if (sic >= 4600 && sic <= 4699) return "Utilities";

  if (sic >= 2000 && sic <= 2111) return "Consumer Staples";
  if (sic >= 5120 && sic <= 5199) return "Consumer Staples";
  if (sic >= 5200 && sic <= 5999) return "Consumer Discretionary";

  if (sic >= 1000 && sic <= 1499) return "Materials";
  if (sic >= 2600 && sic <= 2999) return "Materials";
  if (sic >= 100 && sic <= 999) return "Materials";

  if (sic >= 1300 && sic <= 1399) return "Energy";
  if (sic >= 2900 && sic <= 2999) return "Energy";

  if (sic >= 1500 && sic <= 1799) return "Industrials";
  if (sic >= 3000 && sic <= 3569) return "Industrials";
  if (sic >= 3580 && sic <= 3669) return "Industrials";
  if (sic >= 3680 && sic <= 3699) return "Technology";
  if (sic >= 3700 && sic <= 3999) return "Industrials";
  if (sic >= 4000 && sic <= 4799) return "Industrials";
  if (sic >= 7000 && sic <= 7299) return "Consumer Discretionary";
  if (sic >= 7300 && sic <= 7369) return "Industrials";
  if (sic >= 7380 && sic <= 8999) return "Industrials";

  if (sic >= 9900 && sic <= 9999) return "Other";
  return "Other";
}

export function mapSicToSectorIndustry(
  sic: string | null | undefined,
  sicDescription: string | null | undefined
): SectorIndustry {
  const digits = String(sic || "").replace(/\D/g, "");
  const code = digits ? Number(digits) : NaN;
  const industry = sicDescription?.trim() || null;
  const sector = sectorFromSicCode(code);
  return { sector, industry };
}
