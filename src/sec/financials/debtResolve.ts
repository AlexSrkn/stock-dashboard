import type {
  FinancialMetricKey,
  MetricSourceRef,
} from "./types.js";

/** Balance-sheet debt roles used for hierarchy-aware aggregation. */
export type BalanceSheetDebtRole =
  | "noncurrent"
  | "current_term"
  | "short_term_borrowings"
  | "commercial_paper"
  | "aggregate_term"
  | "footnote";

export interface DebtComponentProvenance {
  role: BalanceSheetDebtRole;
  value: number;
  gaapTag: string;
  namespace?: string | null;
  accn?: string | null;
  filed?: string | null;
  form?: string | null;
}

export interface TotalDebtResolution {
  totalDebt: number;
  /** Noncurrent balance-sheet debt used for the Long-term debt display metric. */
  longTermDebt: number | null;
  components: DebtComponentProvenance[];
  method:
    | "noncurrent_plus_current_plus_cp"
    | "aggregate_term_plus_other"
    | "components_only"
    | "single_component";
}

const NONCURRENT_TAGS = new Set([
  "LongTermDebtNoncurrent",
  "LongTermDebtAndCapitalLeaseObligationsNoncurrent",
  "DebtNoncurrent",
  "LongTermDebtNoncurrentAndCapitalLeaseObligations",
]);

const CURRENT_TERM_TAGS = new Set([
  "LongTermDebtCurrent",
  "LongTermDebtAndCapitalLeaseObligationsCurrent",
  "DebtCurrent",
]);

const SHORT_TERM_TAGS = new Set(["ShortTermBorrowings", "ShortTermDebt"]);

const COMMERCIAL_PAPER_TAGS = new Set(["CommercialPaper", "CommercialPaperCurrent"]);

const AGGREGATE_TERM_TAGS = new Set([
  "LongTermDebt",
  "LongTermDebtAndCapitalLeaseObligations",
]);

/** Footnote / disclosure concepts — never used as balance-sheet total debt. */
const FOOTNOTE_TAGS = new Set([
  "DebtInstrumentCarryingAmount",
  "DebtInstrumentFaceAmount",
  "LongTermDebtFairValue",
  "FairValueOfDebt",
  "SeniorNotes",
  "NotesPayable",
  "ConvertibleDebt",
]);

export function classifyDebtTag(tag: string): BalanceSheetDebtRole | null {
  const t = String(tag || "");
  if (!t) return null;
  if (FOOTNOTE_TAGS.has(t)) return "footnote";
  if (NONCURRENT_TAGS.has(t)) return "noncurrent";
  if (CURRENT_TERM_TAGS.has(t)) return "current_term";
  if (COMMERCIAL_PAPER_TAGS.has(t)) return "commercial_paper";
  if (SHORT_TERM_TAGS.has(t)) return "short_term_borrowings";
  if (AGGREGATE_TERM_TAGS.has(t)) return "aggregate_term";
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sourceAsComponent(
  role: BalanceSheetDebtRole,
  value: number,
  source: MetricSourceRef | undefined
): DebtComponentProvenance | null {
  if (!Number.isFinite(value) || !source?.gaapTag) return null;
  const classified = classifyDebtTag(source.gaapTag);
  if (classified === "footnote") return null;
  return {
    role,
    value,
    gaapTag: source.gaapTag,
    namespace: source.namespace ?? null,
    accn: source.accn ?? null,
    filed: source.filed ?? null,
    form: source.form ?? null,
  };
}

/**
 * Resolve interest-bearing balance-sheet total debt without double-counting
 * parent aggregates with their current/noncurrent children, and without using
 * footnote notes carrying amounts.
 *
 * Preferred: noncurrent + current term (+ short-term borrowings) + commercial paper
 * Fallback: aggregate term debt + other current borrowings/CP not already included
 */
export function resolveTotalDebt(input: {
  longTermDebt: number | null | undefined;
  currentDebt: number | null | undefined;
  commercialPaper: number | null | undefined;
  longTermSource?: MetricSourceRef;
  currentSource?: MetricSourceRef;
  commercialPaperSource?: MetricSourceRef;
}): TotalDebtResolution | null {
  const ltTag = input.longTermSource?.gaapTag ?? "";
  const curTag = input.currentSource?.gaapTag ?? "";
  const cpTag = input.commercialPaperSource?.gaapTag ?? "";

  const ltRole = classifyDebtTag(ltTag);
  const curRole = classifyDebtTag(curTag);
  const cpRole = classifyDebtTag(cpTag);

  const lt =
    input.longTermDebt != null && Number.isFinite(input.longTermDebt)
      ? input.longTermDebt
      : null;
  const cur =
    input.currentDebt != null && Number.isFinite(input.currentDebt) ? input.currentDebt : null;
  const cp =
    input.commercialPaper != null && Number.isFinite(input.commercialPaper)
      ? input.commercialPaper
      : null;

  // Drop footnote-mapped values entirely.
  const longTerm = ltRole === "footnote" ? null : lt;
  const current = curRole === "footnote" ? null : cur;
  const paper = cpRole === "footnote" ? null : cp;

  const components: DebtComponentProvenance[] = [];
  const push = (role: BalanceSheetDebtRole, value: number | null, source?: MetricSourceRef) => {
    if (value == null) return;
    const c = sourceAsComponent(role, value, source);
    if (c) components.push(c);
  };

  const ltIsNoncurrent = ltRole === "noncurrent";
  const ltIsAggregate = ltRole === "aggregate_term";
  const curIsTermCurrent = curRole === "current_term";
  const curIsShortTerm = curRole === "short_term_borrowings";

  // Case A: true noncurrent long-term debt — add current + CP (no parent overlap).
  if (ltIsNoncurrent && longTerm != null) {
    push("noncurrent", longTerm, input.longTermSource);
    if (current != null) {
      push(curIsShortTerm ? "short_term_borrowings" : "current_term", current, input.currentSource);
    }
    // Add CP only when it isn't the same concept already used as current_debt.
    if (paper != null && cpTag && cpTag !== curTag) {
      push("commercial_paper", paper, input.commercialPaperSource);
    }
    const total = round2(
      longTerm +
        (current != null ? current : 0) +
        (paper != null && cpTag && cpTag !== curTag ? paper : 0)
    );
    return {
      totalDebt: total,
      longTermDebt: longTerm,
      components,
      method: "noncurrent_plus_current_plus_cp",
    };
  }

  // Case B: aggregate LongTermDebt already includes current + noncurrent term debt.
  // Do NOT add LongTermDebtCurrent again.
  if (ltIsAggregate && longTerm != null) {
    push("aggregate_term", longTerm, input.longTermSource);
    let extra = 0;
    if (current != null && curIsShortTerm) {
      // Short-term borrowings are usually outside term-debt aggregate.
      push("short_term_borrowings", current, input.currentSource);
      extra += current;
    }
    // If current is term-current, skip — already inside aggregate.
    if (paper != null && cpTag && cpTag !== curTag) {
      push("commercial_paper", paper, input.commercialPaperSource);
      extra += paper;
    }
    return {
      totalDebt: round2(longTerm + extra),
      longTermDebt: null, // aggregate is not "noncurrent long-term debt"
      components,
      method: "aggregate_term_plus_other",
    };
  }

  // Case C: no long-term mapping — sum available current + CP.
  if (longTerm == null && (current != null || paper != null)) {
    if (current != null) {
      push(curIsTermCurrent ? "current_term" : "short_term_borrowings", current, input.currentSource);
    }
    if (paper != null && cpTag && cpTag !== curTag) {
      push("commercial_paper", paper, input.commercialPaperSource);
    }
    const total = round2(
      (current != null ? current : 0) + (paper != null && cpTag !== curTag ? paper : 0)
    );
    return {
      totalDebt: total,
      longTermDebt: null,
      components,
      method: current != null && paper != null ? "components_only" : "single_component",
    };
  }

  // Case D: only long-term value of unknown/other role.
  if (longTerm != null) {
    push(ltRole ?? "aggregate_term", longTerm, input.longTermSource);
    if (current != null && !(ltIsAggregate && curIsTermCurrent)) {
      push(curRole ?? "current_term", current, input.currentSource);
    }
    if (paper != null && cpTag && cpTag !== curTag) {
      push("commercial_paper", paper, input.commercialPaperSource);
    }
    const includeCurrent = current != null && !(ltIsAggregate && curIsTermCurrent);
    const includeCp = paper != null && cpTag !== curTag;
    return {
      totalDebt: round2(
        longTerm + (includeCurrent ? current! : 0) + (includeCp ? paper! : 0)
      ),
      longTermDebt: ltIsNoncurrent ? longTerm : null,
      components,
      method: "components_only",
    };
  }

  return null;
}
