import { isMissing, parseNumber, type Dataset } from "./csv";
import { detectDateFormat, formatDay, isWeekend, parseDate } from "./dates";
import { profileDataset, sampleIndexes, type ColumnProfile } from "./patterns";
import type { ColumnInfo, DatasetProfile, RunSettings, TechnicalType } from "./types";

/*
 * Column profile: what kind of data each column holds. Counts of blanks use every row; everything else
 * uses the same deterministic sample as the pattern engine, so profiling stays fast on large files.
 * Each technical type carries the plain-language reason it was chosen.
 */

const BOOLEAN_PAIRS = [["true", "false"], ["yes", "no"], ["y", "n"], ["1", "0"], ["t", "f"], ["j", "n"]];
const pct = (share: number) => `${(share * 100).toFixed(share >= 0.995 || share === 0 ? 0 : 1)}%`;

export function buildProfile(data: Dataset, settings: RunSettings): DatasetProfile {
  const patterns = profileDataset(data, settings.keepSpecial);
  const sample = sampleIndexes(data.rows.length);
  return {
    rows: data.rows.length,
    columns: data.headers.map((name, index) => columnInfo(data, sample, index, patterns[index], settings)),
    patterns
  };
}

function columnInfo(data: Dataset, sample: number[], index: number, pattern: ColumnProfile, settings: RunSettings): ColumnInfo {
  const name = data.headers[index];
  const present = sample.map((i) => data.rows[i][index]).filter((v) => !isMissing(v)).map((v) => v.trim());
  const counts = new Map<string, number>();
  present.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const topValues = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value, count }));
  const info: ColumnInfo = {
    name,
    index,
    type: "category",
    typeReason: "",
    rows: data.rows.length,
    blank: pattern.blank,
    blankPercent: pattern.blankPercent,
    distinct: counts.size,
    uniquePercent: present.length ? (counts.size / present.length) * 100 : 0,
    topValues,
    examples: pattern.examples
  };
  const set = (type: TechnicalType, reason: string) => ({ ...info, type, typeReason: reason });

  if (!present.length) return set("empty", "Every value is blank.");
  if (counts.size === 1) return set("constant", `Every value is “${present[0]}”.`);

  const detected = detectDateFormat(present);
  if (detected) {
    const format = settings.dateFormats[name] ?? detected.format;
    const days = present.map((v) => parseDate(v, format)).filter((d): d is number => d !== null);
    const min = days.reduce((a, b) => Math.min(a, b), Infinity);
    const max = days.reduce((a, b) => Math.max(a, b), -Infinity);
    const reason = `${pct(detected.parsedShare)} of values are dates in the format ${format}.`;
    return {
      ...set("date", detected.alternatives.length && !settings.dateFormats[name] ? `${reason} The values could also be read as ${detected.alternatives.join(" or ")} — please confirm.` : reason),
      date: {
        format,
        alternatives: [detected.format, ...detected.alternatives].filter((f) => f !== format),
        parsedShare: detected.parsedShare,
        min: days.length ? formatDay(min) : "",
        max: days.length ? formatDay(max) : "",
        weekendShare: days.length ? days.filter(isWeekend).length / days.length : 0
      }
    };
  }

  // Yes/no columns: two values from a known pair hold (nearly) every value; stray values are type errors.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const topTwo = ranked.slice(0, 2);
  const topTwoShare = topTwo.reduce((n, [, c]) => n + c, 0) / present.length;
  const pair = topTwo.length === 2 && topTwoShare >= 0.98 && BOOLEAN_PAIRS.find((p) => topTwo.every(([v]) => p.includes(v.toLowerCase())));
  if (pair) return set("boolean", `Two values, “${topTwo[0][0]}” and “${topTwo[1][0]}”${ranked.length > 2 ? `, hold ${pct(topTwoShare)} of values` : ""}.`);

  if (pattern.isMeasure) {
    const numbers = present.map(parseNumber).filter((n): n is number => n !== null).sort((a, b) => a - b);
    return {
      ...set("measure", "Numbers whose length reflects their size: amounts, quantities or counts."),
      measure: {
        parsedShare: numbers.length / present.length,
        min: numbers[0] ?? 0,
        max: numbers[numbers.length - 1] ?? 0,
        median: numbers[Math.floor(numbers.length / 2)] ?? 0,
        negativeShare: numbers.filter((n) => n < 0).length / Math.max(numbers.length, 1),
        positiveShare: numbers.filter((n) => n > 0).length / Math.max(numbers.length, 1)
      }
    };
  }

  const withSpaces = present.filter((v) => /\s/.test(v)).length / present.length;
  const avgLength = present.reduce((n, v) => n + v.length, 0) / present.length;
  if (withSpaces >= 0.3 && avgLength >= 15) return set("free_text", "Longer text with spaces, such as descriptions or notes.");
  if (info.uniquePercent >= 50) return set("identifier", `${pct(info.uniquePercent / 100)} of values are unique, as expected of identifiers, numbers or codes.`);
  return set("category", `${counts.size} distinct values that repeat, such as types, statuses or codes.`);
}

export const TYPE_LABEL: Record<TechnicalType, string> = {
  identifier: "Identifier",
  category: "Category",
  measure: "Number",
  date: "Date",
  boolean: "Yes/No",
  free_text: "Text",
  constant: "Constant",
  empty: "Empty"
};
