import type { ConflictSignalsPayload, ConflictSignalRow } from "./types.js";
import { CONFLICT_SIGNAL_TYPE_LABELS } from "./types.js";

/**
 * Presentational helper mirroring the Conflict Signals table contract.
 * Live UI is in `app.js` (vanilla); this documents the React-shaped props API.
 */
export interface ConflictSignalsTableProps {
  payload: ConflictSignalsPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
}

export function formatSignedScore(n: number, digits = 1): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const fixed = v.toFixed(digits);
  return v > 0 ? `+${fixed}` : fixed;
}

export function formatConflictScore(n: number, digits = 1): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function signalTypeLabel(type: string): string {
  return CONFLICT_SIGNAL_TYPE_LABELS[type as keyof typeof CONFLICT_SIGNAL_TYPE_LABELS] || type;
}

export function mapConflictRowsForUi(payload: ConflictSignalsPayload): Array<
  ConflictSignalRow & { rank: number; signalTypeLabel: string }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.signals.map((row, idx) => ({
    ...row,
    rank: offset + idx + 1,
    signalTypeLabel: signalTypeLabel(row.signalType),
  }));
}

