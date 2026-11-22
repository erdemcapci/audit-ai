import { isMissing } from "../csv";
import { dayFromIso, parseDate } from "../dates";
import type { TestTemplate } from "../types";
import { card, Collector, column, count, definition, fileRow, percent, quote, severityOf } from "./common";

type ColumnParams = { column: string };

export const blankValues: TestTemplate<ColumnParams> = {
  id: "completeness.blank",
  title: "Blank values",
  dimension: "completeness",
  summary: "Counts missing values in every column.",
  appliesTo: "Every column",
  detailView: "records",
  autoInstances: (profile) => profile.columns.map((c) => definition("completeness.blank", c.name, { column: c.name }, `Every column is checked for missing values.`)),
  describe: (d) => `Values in ${quote(d.params.column)} should not be blank.`,
  run(data, params, ctx) {
    const info = column(ctx.profile, params.column);
    const collector = new Collector();
    // A column that is blank in every row is one finding; listing every row would say nothing more.
    const empty = info.type === "empty";
    data.rows.forEach((r, i) => {
      const value = r[info.index] ?? "";
      if (!isMissing(value)) return;
      if (empty) collector.count();
      else collector.add(fileRow(i), value, value.trim() ? `Placeholder ${quote(value.trim())}` : "Blank");
    });
    const tested = data.rows.length;
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const withinTolerance = collector.total > 0 && rate <= ctx.settings.blankThresholdPercent;
    const severity = withinTolerance ? "low" : severityOf(collector.total, rate, 2, info.type);
    const summary = !collector.total
      ? "No blank values."
      : empty && collector.total === tested ? `The column is blank in every row (${count(tested)} rows).`
      : `${count(collector.total)} of ${count(tested)} values are blank (${percent(rate)})${withinTolerance ? `, within the ${ctx.settings.blankThresholdPercent}% tolerance` : ""}.`;
    return card({ testId: ctx.testId, subject: params.column, tested, collector, severity, summary });
  }
};

/** Text that stands in for a real value. Exact matches only (case-insensitive). */
export const PLACEHOLDER_TOKENS = ["tbd", "tba", "unknown", "unk", "xxx", "dummy", "test", "none", "not available", "not applicable", "n.a.", "?", "??"];
const PLACEHOLDER_DATES = ["0001-01-01", "1899-12-30", "1900-01-01", "1970-01-01", "2099-12-31", "9999-12-31"];
export const PLACEHOLDER_DAYS = new Set(PLACEHOLDER_DATES.map(dayFromIso));

type PlaceholderParams = { column: string; tokens: string[] };

export const placeholderValues: TestTemplate<PlaceholderParams> = {
  id: "completeness.placeholder",
  title: "Placeholder values",
  dimension: "completeness",
  summary: "Finds values that fill a gap instead of holding real data: “TBD”, “0000000”, 31.12.9999.",
  appliesTo: "Columns with varying values (not yes/no columns)",
  detailView: "records",
  autoInstances: (profile) => profile.columns
    .filter((c) => !["empty", "constant", "boolean"].includes(c.type))
    .map((c) => definition("completeness.placeholder", c.name, { column: c.name, tokens: PLACEHOLDER_TOKENS }, "Filled-in placeholders hide missing data from a blank check.")),
  describe: (d) => `${quote(d.params.column)} should hold real values, not placeholders.`,
  run(data, params, ctx) {
    const info = column(ctx.profile, params.column);
    const tokens = new Set(params.tokens.map((t) => t.toLowerCase()));
    const collector = new Collector();
    let tested = 0;
    const reasonFor = (raw: string) => {
      const value = raw.trim();
      if (tokens.has(value.toLowerCase())) return `Placeholder text ${quote(value)}`;
      if (info.type === "date" && info.date) {
        const day = parseDate(value, info.date.format);
        return day !== null && PLACEHOLDER_DAYS.has(day) ? "Placeholder date" : "";
      }
      if (info.type === "measure") return /^-?9{5,}([.,]0+)?$/.test(value) ? "Filler number made of nines" : "";
      return (info.type === "identifier" || info.type === "category") && /^(.)\1{2,}$/.test(value) ? `Repeated character ${quote(value)}` : "";
    };
    const reasons = new Map<string, string>(); // repeated values are judged once
    data.rows.forEach((r, i) => {
      const raw = r[info.index] ?? "";
      if (isMissing(raw)) return;
      tested++;
      let reason = reasons.get(raw);
      if (reason === undefined) { reason = reasonFor(raw); reasons.set(raw, reason); }
      if (reason) collector.add(fileRow(i), raw, reason);
    });
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const summary = collector.total ? `${count(collector.total)} values look like placeholders (${percent(rate)}).` : "No placeholder values.";
    return card({ testId: ctx.testId, subject: params.column, tested, collector, severity: severityOf(collector.total, rate, 2, info.type), summary });
  }
};
