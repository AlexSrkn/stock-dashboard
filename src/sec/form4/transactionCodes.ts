/** SEC Form 4 transaction codes (subset used for signal classification). */

export const HIGH_SIGNAL_CODES = new Set(["P", "S"]);
export const LOW_SIGNAL_CODES = new Set(["A", "M", "F", "G"]);

export function isHighSignalTransactionCode(code: string | null | undefined): boolean {
  const c = String(code ?? "")
    .trim()
    .toUpperCase();
  return HIGH_SIGNAL_CODES.has(c);
}

export function isLowSignalTransactionCode(code: string | null | undefined): boolean {
  const c = String(code ?? "")
    .trim()
    .toUpperCase();
  return LOW_SIGNAL_CODES.has(c);
}

export function classifyTransactionSignal(code: string | null | undefined): boolean {
  const c = String(code ?? "")
    .trim()
    .toUpperCase();
  if (HIGH_SIGNAL_CODES.has(c)) return true;
  if (LOW_SIGNAL_CODES.has(c)) return false;
  return false;
}
