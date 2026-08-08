export function parseDateMs(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const iso = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

export function toIsoDate(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

const MS_YEAR = 365.25 * 86_400_000;

export function yearsBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs <= 0 || toMs <= 0) {
    return Number.NaN;
  }
  return (toMs - fromMs) / MS_YEAR;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
