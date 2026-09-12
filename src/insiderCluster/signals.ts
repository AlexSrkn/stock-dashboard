import { primaryRoleLabel } from "./roleWeights.js";
import type { InsiderClusterDraft } from "./clusterEngine.js";
import {
  CLUSTER_ALERT_MIN_BUYERS,
  CLUSTER_SCORE_EXECUTIVE,
  CLUSTER_SCORE_LIMITED,
  CLUSTER_SCORE_MODERATE,
  CLUSTER_SCORE_STRONG,
} from "./thresholds.js";

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function buildClusterSignal(draft: InsiderClusterDraft, lookbackDays: number): string {
  const parts: string[] = [];
  const score = draft.insiderClusterScore;

  if (score >= CLUSTER_SCORE_EXECUTIVE) {
    parts.push("Executive cluster buying detected.");
  } else if (score >= CLUSTER_SCORE_STRONG) {
    parts.push("Strong insider accumulation across multiple buyers.");
  } else if (score >= CLUSTER_SCORE_MODERATE && draft.buyerCount >= CLUSTER_ALERT_MIN_BUYERS) {
    parts.push("Multiple insiders bought open-market shares in the lookback window.");
  } else if (score >= CLUSTER_SCORE_LIMITED && draft.buyerCount >= 2) {
    parts.push("Open-market buying from multiple insiders in the lookback window.");
  }

  const roles = [...draft.buyerRoles.values()];
  const hasCeo = draft.ceoParticipation;
  const hasCfo = roles.some((r) => primaryRoleLabel(r) === "CFO");
  if (score >= CLUSTER_SCORE_LIMITED && draft.buyerCount >= 1) {
    if (hasCeo && hasCfo) {
      parts.push(`CEO and CFO purchased shares within ${lookbackDays} days.`);
    } else if (hasCeo) {
      parts.push(`CEO purchased shares within ${lookbackDays} days.`);
    }
  }

  if (draft.buyerCount >= 2 && draft.totalBuyValue > 0) {
    parts.push(
      `${draft.buyerCount} insiders accumulated shares worth ${formatUsd(draft.totalBuyValue)}.`
    );
  } else if (draft.buyerCount === 1 && draft.totalBuyValue > 0) {
    parts.push(`One insider bought open-market shares worth ${formatUsd(draft.totalBuyValue)}.`);
  }

  if (!parts.length) {
    if (draft.buyerCount === 1) {
      return "Single open-market purchase in lookback window.";
    }
    if (draft.buyerCount > 1) {
      return `Light open-market buying from ${draft.buyerCount} insiders — below cluster strength.`;
    }
    return "No significant insider cluster in lookback window.";
  }

  return parts.slice(0, 2).join(" ");
}
