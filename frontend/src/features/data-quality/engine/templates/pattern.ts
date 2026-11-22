import { analyzeColumn, type Finding } from "../patterns";
import type { DatasetProfile, TestTemplate } from "../types";
import { card, Collector, count, definition, percent, quote } from "./common";

/** Dates and yes/no values are checked by the "Wrong data type" test instead. */
const typeOf = (profile: DatasetProfile, name: string) => profile.columns.find((c) => c.name === name)?.type;
const coveredElsewhere = (profile: DatasetProfile, name: string) => {
  const type = typeOf(profile, name);
  if (type === "date") return "Date column: invalid dates are found by the “Wrong data type” test.";
  if (type === "boolean") return "Yes/no column: unexpected values are found by the “Wrong data type” test.";
  return "";
};

/** "auto" keeps the grouping chosen by profiling, "none" compares across all records. */
type PatternParams = { column: string; group: string };

export const characterPatterns: TestTemplate<PatternParams> = {
  id: "validity.pattern",
  title: "Format / pattern",
  dimension: "validity",
  summary: "Finds identifiers and codes that break their usual character format, such as a tax number with a missing digit.",
  appliesTo: "Identifier and code columns with a repeating format",
  detailView: "pattern",
  autoInstances: (profile) => profile.patterns
    .filter((p) => p.verdict !== "unsuitable" && !coveredElsewhere(profile, p.column))
    .map((p) => definition("validity.pattern", p.column, { column: p.column, group: "auto" }, p.reasons.join(" "), p.verdict === "suitable")),
  notApplied: (profile) => profile.patterns
    .filter((p) => p.verdict === "unsuitable" || coveredElsewhere(profile, p.column))
    .map((p) => ({ subject: p.column, reason: coveredElsewhere(profile, p.column) || p.reasons.join(" ") })),
  describe: (d) => `Values in ${quote(d.params.column)} should follow the column's usual format${d.params.group !== "auto" && d.params.group !== "none" ? ` within each ${quote(d.params.group)}` : ""}.`,
  run(data, params, ctx) {
    const profile = ctx.profile.patterns.find((p) => p.column === params.column);
    if (!profile) throw new Error(`Column not found: ${params.column}`);
    let groupColumn = profile.grouping?.column ?? null;
    let note = profile.groupingNote;
    if (params.group === "none") { groupColumn = null; note = "Grouping switched off manually."; }
    else if (params.group !== "auto" && data.headers.includes(params.group) && params.group !== params.column) { groupColumn = params.group; note = `Grouped by “${params.group}” (manual selection).`; }
    const finding: Finding = analyzeColumn(data, profile, groupColumn, note, {
      thresholdPercent: ctx.settings.patternThresholdPercent, keepSpecial: ctx.settings.keepSpecial, include: {}, group: {}
    });
    const collector = new Collector();
    finding.anomalyRecords.filter((r) => r.kind === "rare").forEach((r) => collector.add(r.row, r.value, `Pattern ${r.pattern}, usually ${r.usualPattern}${groupColumn ? ` in ${quote(r.group)}` : ""}`));
    // The pattern engine counts every rare value even beyond its own storage cap.
    collector.total = finding.anomalies;
    const summary = finding.anomalies
      ? `${count(finding.anomalies)} values break the usual format (${percent(finding.anomalyPercent)}).`
      : "Every value follows a usual format.";
    return card({
      testId: ctx.testId, subject: params.column, tested: finding.assessed, collector, severity: finding.priority, summary,
      facts: { Comparison: note || (groupColumn ? `Within ${quote(groupColumn)}` : "Across all records"), Patterns: finding.patterns.length },
      detail: finding
    });
  }
};
