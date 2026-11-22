import { isMissing, parseNumber } from "../csv";
import { isWeekend, parseDate, weekday } from "../dates";
import type { TestTemplate } from "../types";
import { card, Collector, column, count, definition, fileRow, percent, quote, severityOf } from "./common";
import { PLACEHOLDER_DAYS } from "./completeness";

type OutlierParams = { column: string; factor: number; scale: "linear" | "log" };

const formatNumber = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const outliers: TestTemplate<OutlierParams> = {
  id: "accuracy.outlier",
  title: "Unusual amounts",
  dimension: "accuracy",
  summary: "Finds numbers far outside the range where most values lie.",
  appliesTo: "Number columns with at least 30 values",
  detailView: "records",
  autoInstances: (profile, settings) => profile.columns
    .filter((c) => c.type === "measure" && c.measure && (c.rows - c.blank) * c.measure.parsedShare >= 30)
    .map((c) => {
      // Amounts are usually skewed: most are small, a few are large. On a log scale "far out" means
      // a different order of magnitude rather than merely the long tail.
      const m = c.measure!;
      const skewed = m.positiveShare >= 0.95 && m.median > 0 && m.max / m.median > 20;
      const scale: OutlierParams["scale"] = skewed ? "log" : "linear";
      return definition("accuracy.outlier", c.name, { column: c.name, factor: settings.outlierFactor, scale }, skewed
        ? "Values span several orders of magnitude, so they are compared on a logarithmic scale."
        : "Values are compared with the range where the middle half of them lie.");
    }),
  describe: (d) => `Values in ${quote(d.params.column)} should not lie far outside the usual range.`,
  run(data, params, ctx) {
    const info = column(ctx.profile, params.column);
    const log = params.scale === "log";
    const entries: { index: number; raw: string; value: number }[] = [];
    data.rows.forEach((r, i) => {
      const raw = r[info.index] ?? "";
      if (isMissing(raw)) return;
      const n = parseNumber(raw);
      if (n === null || (log && n <= 0)) return;
      entries.push({ index: i, raw, value: log ? Math.log10(n) : n });
    });
    const collector = new Collector();
    const tested = entries.length;
    const sorted = entries.map((e) => e.value).sort((a, b) => a - b);
    if (tested < 4) return card({ testId: ctx.testId, subject: params.column, tested, collector, severity: "clean", summary: "Too few numbers to judge what is unusual." });
    const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
    if (iqr === 0) return card({ testId: ctx.testId, subject: params.column, tested, collector, severity: "clean", summary: "Most values are identical, so nothing can be called unusual." });
    const lower = q1 - params.factor * iqr, upper = q3 + params.factor * iqr;
    const back = (v: number) => (log ? 10 ** v : v);
    entries.forEach((e) => {
      if (e.value > upper) collector.add(fileRow(e.index), e.raw, `Above ${formatNumber(back(upper))}`);
      else if (e.value < lower) collector.add(fileRow(e.index), e.raw, `Below ${formatNumber(back(lower))}`);
    });
    const rate = (collector.total / tested) * 100;
    const range = `${formatNumber(back(lower))} – ${formatNumber(back(upper))}`;
    const summary = collector.total ? `${count(collector.total)} values lie outside the usual range of ${range} (${percent(rate)}).` : `Every value lies within ${range}.`;
    return card({
      testId: ctx.testId, subject: params.column, tested, collector, severity: severityOf(collector.total, rate, 1, info.type), summary,
      facts: { "Usual range": range, "Middle half of values": `${formatNumber(back(q1))} – ${formatNumber(back(q3))}`, Scale: log ? "Logarithmic" : "Linear" }
    });
  }
};

type CalendarParams = { column: string };

export const weekendDates: TestTemplate<CalendarParams> = {
  id: "accuracy.calendar",
  title: "Weekend dates",
  dimension: "accuracy",
  summary: "Finds dates on a Saturday or Sunday where weekend dates are otherwise rare.",
  appliesTo: "Date columns where fewer than 10% of dates fall on a weekend",
  detailView: "records",
  autoInstances: (profile) => profile.columns
    .filter((c) => c.type === "date" && c.date && c.date.weekendShare > 0 && c.date.weekendShare < 0.1)
    .map((c) => definition("accuracy.calendar", c.name, { column: c.name }, `Only ${percent(c.date!.weekendShare * 100)} of dates fall on a weekend, so weekend dates stand out.`)),
  describe: (d) => `Dates in ${quote(d.params.column)} should fall on working days.`,
  run(data, params, ctx) {
    const info = column(ctx.profile, params.column);
    const format = info.date?.format ?? "yyyy-MM-dd";
    const collector = new Collector();
    let tested = 0;
    data.rows.forEach((r, i) => {
      const raw = r[info.index] ?? "";
      if (isMissing(raw)) return;
      const day = parseDate(raw, format);
      if (day === null || PLACEHOLDER_DAYS.has(day)) return;
      tested++;
      if (isWeekend(day)) collector.add(fileRow(i), raw, weekday(day) === 6 ? "Saturday" : "Sunday");
    });
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const summary = collector.total ? `${count(collector.total)} dates fall on a weekend (${percent(rate)}).` : "No weekend dates.";
    return card({ testId: ctx.testId, subject: params.column, tested, collector, severity: severityOf(collector.total, rate, 1, info.type), summary });
  }
};
