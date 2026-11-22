import { isMissing, parseNumber } from "../csv";
import { dayFromIso, formatDay, parseDate } from "../dates";
import type { DateFormat, TestTemplate } from "../types";
import { card, Collector, column, count, definition, fileRow, percent, quote, severityOf } from "./common";
import { PLACEHOLDER_DAYS, PLACEHOLDER_TOKENS } from "./completeness";

const PLACEHOLDERS = new Set(PLACEHOLDER_TOKENS);

type TypeParams = { column: string; expected: "date" | "measure" | "boolean"; format?: DateFormat; values?: string[] };

export const typeConformance: TestTemplate<TypeParams> = {
  id: "validity.type",
  title: "Wrong data type",
  dimension: "validity",
  summary: "Finds text in number columns, invalid dates and unexpected values in yes/no columns.",
  appliesTo: "Date, number and yes/no columns",
  detailView: "records",
  autoInstances: (profile) => profile.columns.flatMap((c) => {
    if (c.type === "date" && c.date) return [definition<TypeParams>("validity.type", c.name, { column: c.name, expected: "date", format: c.date.format }, `The column holds dates (${c.date.format}); every value should be a valid date.`)];
    if (c.type === "measure") return [definition<TypeParams>("validity.type", c.name, { column: c.name, expected: "measure" }, "The column holds numbers; every value should be a number.")];
    if (c.type === "boolean") return [definition<TypeParams>("validity.type", c.name, { column: c.name, expected: "boolean", values: c.topValues.slice(0, 2).map((v) => v.value) }, "The column holds two values; nothing else should appear.")];
    return [];
  }),
  describe: (d) => d.params.expected === "date"
    ? `Every value in ${quote(d.params.column)} should be a valid date (${d.params.format}).`
    : d.params.expected === "measure"
      ? `Every value in ${quote(d.params.column)} should be a number.`
      : `${quote(d.params.column)} should only hold ${(d.params.values ?? []).map(quote).join(" or ")}.`,
  run(data, params, ctx) {
    const info = column(ctx.profile, params.column);
    const allowed = new Set((params.values ?? []).map((v) => v.trim()));
    const collector = new Collector();
    let tested = 0;
    data.rows.forEach((r, i) => {
      const raw = r[info.index] ?? "";
      const value = raw.trim();
      if (isMissing(raw) || PLACEHOLDERS.has(value.toLowerCase())) return; // reported by the blank and placeholder tests
      tested++;
      if (params.expected === "date" && parseDate(value, params.format ?? "yyyy-MM-dd") === null) collector.add(fileRow(i), raw, `Not a valid date in the format ${params.format}`);
      else if (params.expected === "measure" && parseNumber(value) === null) collector.add(fileRow(i), raw, "Not a number");
      else if (params.expected === "boolean" && !allowed.has(value)) collector.add(fileRow(i), raw, `Not one of ${[...allowed].map(quote).join(" or ")}`);
    });
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const what = params.expected === "date" ? "are not valid dates" : params.expected === "measure" ? "are not numbers" : "are not one of the two expected values";
    const summary = collector.total ? `${count(collector.total)} values ${what} (${percent(rate)}).` : "Every value has the expected type.";
    return card({ testId: ctx.testId, subject: params.column, tested, collector, severity: severityOf(collector.total, rate, 3, info.type), summary });
  }
};

type AllowedParams = { column: string; allowed: string[] | null };

const normalise = (value: string) => value.trim().toLowerCase().replace(/[\s._\-/]+/g, "");
const shown = (value: string) => quote(value.replace(/^\s+|\s+$/g, (s) => "·".repeat(s.length)));

export const allowedValues: TestTemplate<AllowedParams> = {
  id: "validity.allowed_values",
  title: "Inconsistent spelling",
  dimension: "validity",
  summary: "Finds category values written in more than one way, such as “EUR”, “Eur” and “EUR ”.",
  appliesTo: "Category columns",
  detailView: "records",
  autoInstances: (profile) => profile.columns
    .filter((c) => c.type === "category")
    .map((c) => definition("validity.allowed_values", c.name, { column: c.name, allowed: null }, "Category values should be spelled one way, or grouping and filtering miss records.")),
  describe: (d) => d.params.allowed
    ? `${quote(d.params.column)} should only hold ${d.params.allowed.map(quote).join(", ")}.`
    : `Each value in ${quote(d.params.column)} should be spelled one way only.`,
  run(data, params, ctx) {
    const info = column(ctx.profile, params.column);
    const collector = new Collector();
    let tested = 0;
    const allowed = params.allowed ? new Set(params.allowed) : null;
    // Most frequent exact spelling per normalised value.
    const spellings = new Map<string, Map<string, number>>();
    data.rows.forEach((r) => {
      const raw = r[info.index] ?? "";
      if (isMissing(raw)) return;
      const key = normalise(raw);
      const variants = spellings.get(key) ?? new Map<string, number>();
      variants.set(raw, (variants.get(raw) ?? 0) + 1);
      spellings.set(key, variants);
    });
    const usual = new Map([...spellings.entries()].map(([key, variants]) => [key, [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
    let variantGroups = 0;
    spellings.forEach((variants) => { if (variants.size > 1) variantGroups++; });
    data.rows.forEach((r, i) => {
      const raw = r[info.index] ?? "";
      if (isMissing(raw)) return;
      tested++;
      if (allowed) {
        if (!allowed.has(raw.trim())) collector.add(fileRow(i), raw, "Not an allowed value");
        return;
      }
      const expected = usual.get(normalise(raw))!;
      if (raw !== expected) collector.add(fileRow(i), raw, `Written ${shown(raw)}, usually ${shown(expected)}`);
    });
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const summary = !collector.total
      ? allowed ? "Every value is allowed." : "Every value is spelled consistently."
      : allowed
        ? `${count(collector.total)} values are not on the allowed list (${percent(rate)}).`
        : `${count(variantGroups)} value${variantGroups === 1 ? " is" : "s are"} spelled in more than one way, affecting ${count(collector.total)} records (${percent(rate)}).`;
    return card({ testId: ctx.testId, subject: params.column, tested, collector, severity: severityOf(collector.total, rate, 1, info.type), summary });
  }
};

type RangeParams = { column: string; kind: "measure"; rareNegatives: true } | { column: string; kind: "date"; minDate: string; maxDate: string };

export const valueRange: TestTemplate<RangeParams> = {
  id: "validity.range",
  title: "Values out of range",
  dimension: "validity",
  summary: "Finds future or implausibly old dates, and negative numbers where they are rare.",
  appliesTo: "Date columns, and number columns with a few negative values",
  detailView: "records",
  autoInstances: (profile) => {
    const today = formatDay(Math.floor(Date.now() / 86400000));
    return profile.columns.flatMap((c) => {
      if (c.type === "date") return [definition<RangeParams>("validity.range", c.name, { column: c.name, kind: "date", minDate: "1990-01-01", maxDate: today }, `Dates should lie between 1990 and the day the plan was made (${today}).`)];
      if (c.type === "measure" && c.measure && c.measure.negativeShare > 0 && c.measure.negativeShare < 0.05) {
        return [definition<RangeParams>("validity.range", c.name, { column: c.name, kind: "measure", rareNegatives: true }, `Only ${percent(c.measure.negativeShare * 100)} of values are negative, so negative values stand out.`)];
      }
      return [];
    });
  },
  describe: (d) => d.params.kind === "date"
    ? `Dates in ${quote(d.params.column)} should lie between ${d.params.minDate} and ${d.params.maxDate}.`
    : `Values in ${quote(d.params.column)} should not be negative.`,
  run(data, params, ctx) {
    const info = column(ctx.profile, params.column);
    const collector = new Collector();
    let tested = 0;
    const min = params.kind === "date" ? dayFromIso(params.minDate) : 0;
    const max = params.kind === "date" ? dayFromIso(params.maxDate) : 0;
    const format = info.date?.format ?? "yyyy-MM-dd";
    data.rows.forEach((r, i) => {
      const raw = r[info.index] ?? "";
      if (isMissing(raw)) return;
      if (params.kind === "date") {
        const day = parseDate(raw, format);
        if (day === null || PLACEHOLDER_DAYS.has(day)) return; // reported by the type and placeholder tests
        tested++;
        if (day > max) collector.add(fileRow(i), raw, `After ${params.maxDate}`);
        else if (day < min) collector.add(fileRow(i), raw, `Before ${params.minDate}`);
      } else {
        const n = parseNumber(raw);
        if (n === null) return;
        tested++;
        if (n < 0) collector.add(fileRow(i), raw, "Negative value");
      }
    });
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const summary = collector.total
      ? params.kind === "date" ? `${count(collector.total)} dates lie outside ${params.minDate} – ${params.maxDate} (${percent(rate)}).` : `${count(collector.total)} values are negative (${percent(rate)}).`
      : params.kind === "date" ? "Every date lies in the expected range." : "No negative values.";
    return card({ testId: ctx.testId, subject: params.column, tested, collector, severity: severityOf(collector.total, rate, 2, info.type), summary });
  }
};
