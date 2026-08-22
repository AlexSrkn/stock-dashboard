import { formatSecCik, SecHttpError, secThrottle } from "../http.js";
import { downloadSecSubmissionsByTicker, lookupCikFromTicker } from "../submissions.js";
import { resolveIssuerSecurityContext } from "../../issuers/repository.js";
import { mapSicToSectorIndustry } from "../../stocks/sicMapping.js";
import { getStocksRepository } from "../../stocks/stocksRepository.js";
import { fetchCompanyFacts } from "./companyFacts.js";
import { discoverFinancialFilings } from "./discoverFilings.js";
import { pickDerivedLatest } from "./derivedMetrics.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import { tryPersistFinancials } from "./financialsRepository.js";
import { parse8kEarningsReleases } from "./parse8kEarnings.js";
import { supplementQuarterlyFromSixKExhibits } from "./sixK/extractSixKFinancials.js";
import type { FilingsFundamentalsResponse } from "./types.js";

export interface GetFilingsFundamentalsOptions {
  annualFilingLimit?: number;
  quarterlyFilingLimit?: number;
  currentFilingLimit?: number;
  annualPeriodLimit?: number;
  quarterlyPeriodLimit?: number;
}

function buildKnownAccessions(
  filings: FilingsFundamentalsResponse["filings"]
): Set<string> {
  const set = new Set<string>();
  for (const group of Object.values(filings)) {
    for (const row of group) {
      if (row.accessionNumber) set.add(row.accessionNumber);
    }
  }
  return set;
}

function companyFactsMissingMessage(ticker: string, cik: string): string {
  return (
    `No SEC Company Facts XBRL for ${ticker} (CIK ${cik.replace(/^0+/, "")}). ` +
    `This listing may not file structured financials in EDGAR.`
  );
}

async function loadCompanyFactsForFilingCik(
  requestedTicker: string,
  ownCik: number,
  filingTicker: string
): Promise<{ facts: Awaited<ReturnType<typeof fetchCompanyFacts>>; sourceTicker: string | null; factsCik: number }> {
  const filingCik = await lookupCikFromTicker(filingTicker);
  try {
    const facts = await fetchCompanyFacts(filingCik);
    const sourceTicker = filingTicker !== requestedTicker ? filingTicker : null;
    return { facts, sourceTicker, factsCik: filingCik };
  } catch (err) {
    const isMissing =
      err instanceof SecHttpError &&
      (err.statusCode === 404 || /NoSuchKey/i.test(err.message));
    if (!isMissing) throw err;
    if (filingTicker === requestedTicker) {
      throw new SecHttpError(
        companyFactsMissingMessage(requestedTicker, formatSecCik(ownCik)),
        404,
        err instanceof SecHttpError ? err.url : ""
      );
    }
    throw new SecHttpError(
      companyFactsMissingMessage(requestedTicker, formatSecCik(ownCik)),
      404,
      err instanceof SecHttpError ? err.url : ""
    );
  }
}

export async function getFilingsFundamentals(
  ticker: string,
  options: GetFilingsFundamentalsOptions = {}
): Promise<FilingsFundamentalsResponse> {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) throw new Error("Missing ticker");

  const ownCik = await lookupCikFromTicker(sym);
  const submissions = await downloadSecSubmissionsByTicker({ ticker: sym });
  await secThrottle();

  const issuerCtx = await resolveIssuerSecurityContext(sym);
  const filingTicker = issuerCtx?.filingTicker ?? sym;

  const { facts: companyFacts, sourceTicker, factsCik } = await loadCompanyFactsForFilingCik(
    sym,
    ownCik,
    filingTicker
  );

  const filingsSubmissions =
    filingTicker !== sym
      ? await downloadSecSubmissionsByTicker({ ticker: filingTicker })
      : submissions;

  const extracted = extractFinancialsFromCompanyFacts(companyFacts);
  const filings = discoverFinancialFilings(filingsSubmissions, factsCik, {
    annualLimit: options.annualFilingLimit,
    quarterlyLimit: options.quarterlyFilingLimit,
    currentLimit: options.currentFilingLimit,
  });

  let quarterly = extracted.quarterly;
  if (filings["10-Q"].length) {
    quarterly = await supplementQuarterlyFromSixKExhibits(
      factsCik,
      filings["10-Q"],
      extracted.quarterly,
      6
    );
  }

  const annual = extracted.annual.slice(0, options.annualPeriodLimit ?? 5);
  quarterly = quarterly.slice(0, options.quarterlyPeriodLimit ?? 8);
  const earningsReleases = parse8kEarningsReleases(companyFacts, filings["8-K"]);

  const sic = submissions.sic ? String(submissions.sic).trim() : null;
  const sicDescription = submissions.sicDescription
    ? String(submissions.sicDescription).trim()
    : null;
  const { sector, industry } = mapSicToSectorIndustry(sic, sicDescription);
  const companyName = submissions.name ? String(submissions.name).trim() : null;

  await getStocksRepository().upsert({
    ticker: sym,
    companyName,
    sector,
    industry,
    sic,
    sicDescription,
    cik: formatSecCik(ownCik),
  });
  const stored = await getStocksRepository().getByTicker(sym);

  const derived = pickDerivedLatest(annual, quarterly);

  const response: FilingsFundamentalsResponse = {
    ticker: sym,
    cik: formatSecCik(factsCik),
    entityName: submissions.name || companyFacts.entityName || "",
    source: "sec-company-facts",
    fundamentalsSourceTicker: sourceTicker,
    canonicalIssuer: issuerCtx
      ? {
          id: issuerCtx.issuer.id,
          slug: issuerCtx.issuer.slug,
          name: issuerCtx.issuer.name,
          primaryTicker: issuerCtx.issuer.primaryTicker,
        }
      : null,
    securityListing: issuerCtx
      ? {
          ticker: issuerCtx.listing.ticker,
          listingKind: issuerCtx.listing.listingKind,
          isPrimaryFiling: issuerCtx.listing.isPrimaryFiling,
        }
      : null,
    classification: stored
      ? {
          sector: stored.sector,
          industry: stored.industry,
          sic: stored.sic,
          sicDescription: stored.sicDescription,
        }
      : sector || industry || sic
        ? { sector, industry, sic, sicDescription }
        : null,
    latest: extracted.latest,
    annual,
    quarterly,
    statements: {
      incomeStatement: {
        ...extracted.statements.incomeStatement,
        annual: extracted.statements.incomeStatement.annual.slice(0, options.annualPeriodLimit ?? 5),
        quarterly: extracted.statements.incomeStatement.quarterly.slice(
          0,
          options.quarterlyPeriodLimit ?? 8
        ),
      },
      balanceSheet: {
        ...extracted.statements.balanceSheet,
        annual: extracted.statements.balanceSheet.annual.slice(0, options.annualPeriodLimit ?? 5),
        quarterly: extracted.statements.balanceSheet.quarterly.slice(
          0,
          options.quarterlyPeriodLimit ?? 8
        ),
      },
      cashFlow: {
        ...extracted.statements.cashFlow,
        annual: extracted.statements.cashFlow.annual.slice(0, options.annualPeriodLimit ?? 5),
        quarterly: extracted.statements.cashFlow.quarterly.slice(
          0,
          options.quarterlyPeriodLimit ?? 8
        ),
      },
    },
    derivedLatest: derived.values,
    derivedPeriodLabels: derived.periodLabels,
    earningsReleases,
    filings,
  };

  const knownAccessions = buildKnownAccessions(filings);
  for (const row of quarterly) {
    if (row.accessionNumber) knownAccessions.add(row.accessionNumber);
  }

  await tryPersistFinancials({
    cik: response.cik,
    ticker: sym,
    issuerId: issuerCtx?.issuer.id ?? null,
    annual,
    quarterly,
    earningsReleases,
    knownAccessions,
  });

  return response;
}
