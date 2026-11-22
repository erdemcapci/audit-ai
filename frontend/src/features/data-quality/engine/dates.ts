import type { DateFormat } from "./types";

const TIME = String.raw`(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?`;

/** Regex per format and the capture-group positions of year, month and day. */
const FORMATS: Record<DateFormat, { re: RegExp; y: number; m: number; d: number }> = {
  "yyyy-MM-dd": { re: new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`), y: 1, m: 2, d: 3 },
  "yyyy/MM/dd": { re: new RegExp(String.raw`^(\d{4})/(\d{1,2})/(\d{1,2})${TIME}$`), y: 1, m: 2, d: 3 },
  "dd.MM.yyyy": { re: new RegExp(String.raw`^(\d{1,2})\.(\d{1,2})\.(\d{4})${TIME}$`), y: 3, m: 2, d: 1 },
  "dd/MM/yyyy": { re: new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${TIME}$`), y: 3, m: 2, d: 1 },
  "MM/dd/yyyy": { re: new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${TIME}$`), y: 3, m: 1, d: 2 },
  "dd-MM-yyyy": { re: new RegExp(String.raw`^(\d{1,2})-(\d{1,2})-(\d{4})${TIME}$`), y: 3, m: 2, d: 1 }
};

/** Preference when several formats read the values equally well. */
export const DATE_FORMATS = Object.keys(FORMATS) as DateFormat[];

const DAY_MS = 86400000;

/** Days since 1970-01-01 (UTC), or null when the value is not a real date in this format. */
export function parseDate(value: string, format: DateFormat): number | null {
  const spec = FORMATS[format];
  const match = spec.re.exec(value.trim());
  if (!match) return null;
  const y = Number(match[spec.y]), m = Number(match[spec.m]), d = Number(match[spec.d]);
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(2000, m - 1, 1));
  date.setUTCFullYear(y);
  date.setUTCDate(d);
  if (date.getUTCMonth() !== m - 1) return null; // 31.02. rolled over into March
  return Math.floor(date.getTime() / DAY_MS);
}

export function formatDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function dayFromIso(iso: string): number {
  return parseDate(iso, "yyyy-MM-dd") ?? 0;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export const isWeekend = (day: number) => {
  const w = weekday(day);
  return w === 0 || w === 6;
};

/**
 * The format that reads at least 90% of the values. When several formats read them equally well
 * (every day <= 12), the first in DATE_FORMATS wins and the others are returned as alternatives.
 */
export function detectDateFormat(values: string[]): { format: DateFormat; alternatives: DateFormat[]; parsedShare: number } | null {
  if (!values.length) return null;
  const shares = DATE_FORMATS.map((format) => ({ format, share: values.filter((v) => parseDate(v, format) !== null).length / values.length }));
  const best = Math.max(...shares.map((s) => s.share));
  if (best < 0.9) return null;
  const tied = shares.filter((s) => s.share >= best - 1e-9).map((s) => s.format);
  return { format: tied[0], alternatives: tied.slice(1), parsedShare: best };
}
