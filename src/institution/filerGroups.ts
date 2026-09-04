import { formatSecCik } from "../sec/http.js";

/**
 * Multi-filer investment groups: one brand / institution page can span several
 * SEC CIKs. The primary CIK typically files a 13F combination report covering
 * included managers; those managers usually file 13F-NT (no info table).
 * Some related entities file separate 13F-HRs.
 *
 * Holdings for the primary profile use the primary CIK's richest filing for the
 * quarter (combination report). Related CIKs are exposed for navigation / future
 * aggregation — do not blindly SUM member 13F-HRs into the parent (risk of
 * double-counting when the combo already includes them).
 */
export interface InstitutionFilerGroup {
  id: string;
  displayName: string;
  /** Canonical profile CIK (URL / primary identity). */
  primaryCik: string;
  /** Related SEC CIKs (included managers + separately reporting affiliates). */
  memberCiks: string[];
  note?: string;
}

export const INSTITUTION_FILER_GROUPS: InstitutionFilerGroup[] = [
  {
    id: "amundi",
    displayName: "Amundi",
    primaryCik: "1330387",
    memberCiks: [
      "1330387", // Amundi (combination report)
      "1280690", // Amundi Asset Management
      "1696432", // Amundi Austria
      "1732769", // Amundi Czech Republic Asset Management
      "1731532", // Amundi Deutschland
      "1696433", // Amundi Hong Kong
      "1482818", // Amundi Japan
      "1941328", // Amundi Taiwan
      "1330434", // CPR Asset Management
      "1482820", // Societe Generale Gestion
      "1410251", // KBI Global Investors
      "1463879", // KBI Global Investors (North America)
      "1730946", // Sabadell Asset Management
      "1905668", // Amundi Singapore
      "1768066", // Amundi Ireland
      "1932771", // Amundi SGR
      "1935237", // Amundi UK
      "1935264", // Amundi Czech Republic Investicni
      "1362200", // BFT Investment Managers
      "2080520", // ABN AMRO Investment Solutions (often files separately)
    ],
    note:
      "Parent files 13F combination reports covering included managers; many subsidiaries file 13F-NT only. Thin amendments (e.g. NEW HOLDINGS) must not replace the full combination report for the quarter.",
  },
];

export function getFilerGroupByPrimaryCik(cik: string): InstitutionFilerGroup | null {
  const padded = formatSecCik(cik);
  return (
    INSTITUTION_FILER_GROUPS.find((g) => formatSecCik(g.primaryCik) === padded) ?? null
  );
}

/**
 * CIKs to query for holdings/activity on an institution profile.
 * Uses the primary filer only; combination reports already consolidate included managers.
 * Group members are listed on meta.relatedCiks for navigation.
 */
export function resolveHoldingsCiksForProfile(cik: string): {
  ciks: string[];
  group: InstitutionFilerGroup | null;
} {
  const padded = formatSecCik(cik);
  const group = getFilerGroupByPrimaryCik(padded);
  return { ciks: [padded], group };
}

export function relatedCiksForGroup(group: InstitutionFilerGroup | null): string[] | undefined {
  if (!group) return undefined;
  return [...new Set(group.memberCiks.map((c) => formatSecCik(c)))];
}
