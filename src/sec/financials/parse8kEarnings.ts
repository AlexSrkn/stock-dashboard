import { collectObservationsForAccession } from "./extractFacts.js";
import { hasItem202 } from "./periodUtils.js";
import type { EarningsReleaseRow, SecCompanyFacts, SecFinancialFilingRow } from "./types.js";

export function parse8kEarningsReleases(
  facts: SecCompanyFacts,
  eightKFilings: SecFinancialFilingRow[]
): EarningsReleaseRow[] {
  const releases: EarningsReleaseRow[] = [];

  for (const filing of eightKFilings) {
    if (!hasItem202(filing.items)) continue;
    const picks = collectObservationsForAccession(facts, filing.accessionNumber, "8-K");
    if (!picks.size) continue;

    const metrics: EarningsReleaseRow["metrics"] = {};
    const metricSources: EarningsReleaseRow["metricSources"] = {};
    for (const [key, pick] of picks) {
      metrics[key] = pick.value;
      metricSources[key] = {
        gaapTag: pick.gaapTag,
        namespace: pick.namespace,
        accn: pick.obs.accn ? String(pick.obs.accn) : null,
        filed: pick.obs.filed ? String(pick.obs.filed).slice(0, 10) : null,
        form: pick.obs.form ? String(pick.obs.form) : null,
      };
    }

    releases.push({
      form: filing.form,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      accessionNumber: filing.accessionNumber,
      items: filing.items,
      href: filing.href,
      metrics,
      metricSources,
    });
  }

  return releases;
}
