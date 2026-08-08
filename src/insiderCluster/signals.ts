import { primaryRoleLabel } from "./roleWeights.js";
import type { InsiderClusterDraft } from "./clusterEngine.js";

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function buildClusterSignal(draft: InsiderClusterDraft, lookbackDays: number): string {
  const parts: string[] = [];

  if (draft.insiderClusterScore >= 85) {
    parts.push("Executive cluster buying detected.");
  } else if (draft.insiderClusterScore >= 70) {
    parts.push("High-conviction insider accumulation.");
  } else if (draft.buyerCount >= 3) {
    parts.push("Broad executive participation detected.");
  }

  const roles = [...draft.buyerRoles.values()];
  const hasCeo = draft.ceoParticipation;
  const hasCfo = roles.some((r) => primaryRoleLabel(r) === "CFO");
  if (hasCeo && hasCfo) {
    parts.push(`CEO and CFO purchased shares within ${lookbackDays} days.`);
  } else if (hasCeo) {
    parts.push(`CEO purchased shares within ${lookbackDays} days.`);
  }

  if (draft.buyerCount >= 2 && draft.totalBuyValue > 0) {
    parts.push(
      `${draft.buyerCount} insiders accumulated shares worth ${formatUsd(draft.totalBuyValue)}.`
    );
  }

  if (!parts.length) {
    if (draft.buyerCount === 1) {
      return "Single insider purchase in lookback window.";
    }
    return "No significant insider cluster in lookback window.";
  }

  return parts.slice(0, 2).join(" ");
}
