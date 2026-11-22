import type { DateFormat } from "./types";

const TIME = String.raw`(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?[AaPp][Mm])?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Regex per format and the capture-group positions of year, month and day. Two-digit years pivot at
 * 50 (24 -> 2024, 87 -> 1987). Compact yyyyMMdd only accepts years 1900–2100, so 8-digit
 * identifiers are not mistaken for dates.
 */
type Spec = { re: RegExp; y: number; m: number; d: number; shortYear?: boolean; monthName?: boolean; years?: [number, number] };
const FORMATS: Record<DateFormat, Spec> = {
  "yyyy-MM-dd": { re: new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`), y: 1, m: 2, d: 3 },
  "yyyy/MM/dd": { re: new RegExp(String.raw`^(\d{4})/(\d{1,2})/(\d{1,2})${TIME}$`), y: 1, m: 2, d: 3 },
  "dd.MM.yyyy": { re: new RegExp(String.raw`^(\d{1,2})\.(\d{1,2})\.(\d{4})${TIME}$`), y: 3, m: 2, d: 1 },
  "dd/MM/yyyy": { re: new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${TIME}$`), y: 3, m: 2, d: 1 },
  "MM/dd/yyyy": { re: new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${TIME}$`), y: 3, m: 1, d: 2 },
  "dd-MM-yyyy": { re: new RegExp(String.raw`^(\d{1,2})-(\d{1,2})-(\d{4})${TIME}$`), y: 3, m: 2, d: 1 },
  "d-MMM-yyyy": { re: new RegExp(String.raw`^(\d{1,2})[-\s./]([A-Za-z]{3,9})\.?[-\s./,]+(\d{4}|\d{2})${TIME}$`), y: 3, m: 2, d: 1, monthName: true },
  "yyyyMMdd": { re: /^(\d{4})(\d{2})(\d{2})$/, y: 1, m: 2, d: 3, years: [1900, 2100] },
  "dd.MM.yy": { re: new RegExp(String.raw`^(\d{1,2})\.(\d{1,2})\.(\d{2})${TIME}$`), y: 3, m: 2, d: 1, shortYear: true },
  "dd/MM/yy": { re: new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{2})${TIME}$`), y: 3, m: 2, d: 1, shortYear: true },
  "MM/dd/yy": { re: new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{2})${TIME}$`), y: 3, m: 1, d: 2, shortYear: true }
};

/** Preference when several formats read the values equally well. */
export const DATE_FORMATS = Object.keys(FORMATS) as DateFormat[];

const DAY_MS = 86400000;

const fullYear = (y: number, digits: number) => (digits === 2 ? (y < 50 ? 2000 + y : 1900 + y) : y);

/** Days since 1970-01-01 (UTC), or null when the value is not a real date in this format. */
export function parseDate(value: string, format: DateFormat): number | null {
  const spec = FORMATS[format];
  const match = spec.re.exec(value.trim());
  if (!match) return null;
  const yearText = match[spec.y];
  const y = fullYear(Number(yearText), yearText.length);
  const m = spec.monthName ? MONTHS.indexOf(match[spec.m].slice(0, 3).toLowerCase()) + 1 : Number(match[spec.m]);
  const d = Number(match[spec.d]);
  if (spec.shortYear && yearText.length !== 2) return null;
  if (spec.years && (y < spec.years[0] || y > spec.years[1])) return null;
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(2000, m - 1, 1));
  date.setUTCFullYear(y);
  date.setUTCDate(d);
  if (date.getUTCMonth() !== m - 1) return null; // 31.02. rolled over into March
  return Math.floor(date.getTime() / DAY_MS);
}

export function formatDay(day: number): string {
  const date = new Date(day * DAY_MS);
  const y = date.getUTCFullYear();
  return `${String(y).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
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
  const shareOf = (format: DateFormat, list: string[]) => list.filter((v) => parseDate(v, format) !== null).length / list.length;
  // Most columns are not dates: rule them out on a small, evenly spread probe before reading every value.
  const step = Math.max(1, Math.floor(values.length / 200));
  const probe = values.filter((_, i) => i % step === 0);
  const candidates = DATE_FORMATS.filter((format) => shareOf(format, probe) >= 0.8);
  if (!candidates.length) return null;
  const shares = candidates.map((format) => ({ format, share: shareOf(format, values) }));
  const best = Math.max(...shares.map((s) => s.share));
  if (best < 0.9) return null;
  const tied = shares.filter((s) => s.share >= best - 1e-9).map((s) => s.format);
  return { format: tied[0], alternatives: tied.slice(1), parsedShare: best };
}
