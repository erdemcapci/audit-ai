import { isMissing, type Dataset } from "../csv";
import { formatDay } from "../dates";
import { compareValues, evaluateCondition, orderedReader, ruleId, ruleLabel, ruleSentence } from "../rules";
import type { Classification, ColumnInfo, ResultCard, RuleParams, RunContext, Severity, TestTemplate } from "../types";
import { card, Collector, column, count, fileRow, percent, quote, severityOf } from "./common";

/*
 * Dataset rules: business rules between columns, proposed by discovery or added by the auditor.
 * Each rule is a hypothesis, so its result is classified by violation rate before it counts as a
 * finding: a rule broken by 40% of rows is most likely a wrong rule, not 40% wrong data.
 */

export const datasetRules: TestTemplate<RuleParams> = {
  id: "rule",
  title: "Dataset rules",
  dimension: "consistency",
  summary: "Checks rules between columns: dates in the right order, the same number with the same name, amounts that add up.",
  appliesTo: "Files where related columns were found, or rules you add",
  detailView: "records",
  autoInstances: (profile) => profile.relationships.map((r) => ({
    id: ruleId(r.rule),
    template: "rule",
    subject: ruleLabel(r.rule),
    params: r.rule,
    source: "discovered",
    reason: `Found in the data: holds for ${percent(r.holdRate * 100)} of ${count(r.checked)} sampled rows.`,
    enabled: r.holdRate >= 0.99
  })),
  describe: (d, profile) => ruleSentence(d.params, profile ?? null),
  run(data, params, ctx) {
    switch (params.kind) {
      case "compare": return runCompare(data, params, ctx);
      case "conditional": return runConditional(data, params, ctx);
      case "dependency": return runDependency(data, params, ctx);
      case "arithmetic": return runArithmetic(data, params, ctx);
    }
  }
};

export function classify(exceptions: number, ratePercent: number, ctx: RunContext): Classification {
  if (!exceptions) return "holds";
  if (ratePercent <= ctx.settings.ruleFindingMaxPercent) return "finding";
  if (ratePercent <= ctx.settings.ruleUncertainMaxPercent) return "uncertain";
  return "rule_did_not_hold";
}

function ruleCard(params: RuleParams, ctx: RunContext, tested: number, collector: Collector, facts?: Record<string, string | number>): ResultCard {
  const rate = tested ? (collector.total / tested) * 100 : 0;
  const classification = classify(collector.total, rate, ctx);
  const severity: Severity = classification === "holds" ? "clean" : classification === "finding" ? severityOf(collector.total, rate, 2) : "low";
  const broken = `${count(collector.total)} of ${count(tested)} rows break the rule (${percent(rate)})`;
  const summary = !tested
    ? "No rows to check: the columns are blank or unreadable."
    : classification === "holds" ? `The rule holds for all ${count(tested)} rows checked.`
    : classification === "finding" ? `${broken}.`
    : classification === "uncertain" ? `${broken} — too many to be simple exceptions. Check whether the rule really applies.`
    : `The rule does not hold for ${percent(rate)} of rows, so it is probably not a rule for this file.`;
  const result = card({ testId: ctx.testId, subject: ruleLabel(params), tested, collector, severity, summary, facts });
  return { ...result, classification };
}

const display = (info: ColumnInfo, value: number) => (info.type === "date" ? formatDay(value) : value.toLocaleString("en-US", { maximumFractionDigits: 4 }));

function runCompare(data: Dataset, params: Extract<RuleParams, { kind: "compare" }>, ctx: RunContext) {
  const left = column(ctx.profile, params.left), right = column(ctx.profile, params.right);
  const readLeft = orderedReader(left), readRight = orderedReader(right);
  const collector = new Collector();
  let tested = 0;
  data.rows.forEach((r, i) => {
    const a = readLeft(r[left.index] ?? ""), b = readRight(r[right.index] ?? "");
    if (a === null || b === null) return;
    tested++;
    if (!compareValues(a, params.op, b)) collector.add(fileRow(i), `${display(left, a)} | ${display(right, b)}`, `${quote(params.left)} ${display(left, a)} vs ${quote(params.right)} ${display(right, b)}`);
  });
  return ruleCard(params, ctx, tested, collector);
}

function runConditional(data: Dataset, params: Extract<RuleParams, { kind: "conditional" }>, ctx: RunContext) {
  const ifInfo = column(ctx.profile, params.if.column), thenInfo = column(ctx.profile, params.then.column);
  const collector = new Collector();
  let tested = 0;
  data.rows.forEach((r, i) => {
    if (evaluateCondition(params.if, r, ifInfo) !== true) return;
    const result = evaluateCondition(params.then, r, thenInfo);
    if (result === null) return;
    tested++;
    if (!result) {
      const value = r[thenInfo.index] ?? "";
      collector.add(fileRow(i), `${(r[ifInfo.index] ?? "").trim() || "(blank)"} | ${value.trim() || "(blank)"}`, `${quote(params.then.column)} is ${isMissing(value) ? "blank" : quote(value.trim())}`);
    }
  });
  return ruleCard(params, ctx, tested, collector);
}

function runDependency(data: Dataset, params: Extract<RuleParams, { kind: "dependency" }>, ctx: RunContext) {
  const from = column(ctx.profile, params.from), to = column(ctx.profile, params.to);
  const groups = new Map<string, Map<string, number>>();
  data.rows.forEach((r) => {
    const a = r[from.index] ?? "", b = r[to.index] ?? "";
    if (isMissing(a) || isMissing(b)) return;
    const counts = groups.get(a.trim()) ?? new Map<string, number>();
    counts.set(b.trim(), (counts.get(b.trim()) ?? 0) + 1);
    groups.set(a.trim(), counts);
  });
  // The usual partner of each value; only values seen more than once can be checked.
  const usual = new Map<string, { value: string; count: number; total: number }>();
  groups.forEach((counts, key) => {
    const total = [...counts.values()].reduce((n, c) => n + c, 0);
    if (total < 2) return;
    const [value, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    usual.set(key, { value, count: n, total });
  });
  const collector = new Collector();
  let tested = 0, conflicting = 0;
  usual.forEach((u, key) => { if (groups.get(key)!.size > 1) conflicting++; });
  data.rows.forEach((r, i) => {
    const a = (r[from.index] ?? "").trim(), b = (r[to.index] ?? "").trim();
    const u = usual.get(a);
    if (!u || isMissing(b)) return;
    tested++;
    if (b !== u.value) collector.add(fileRow(i), `${a} | ${b}`, `${quote(a)} usually comes with ${quote(u.value)} (${count(u.count)} of ${count(u.total)} rows)`);
  });
  return ruleCard(params, ctx, tested, collector, conflicting ? { [`${params.from} values with more than one ${params.to}`]: conflicting } : undefined);
}

function runArithmetic(data: Dataset, params: Extract<RuleParams, { kind: "arithmetic" }>, ctx: RunContext) {
  const [a, b] = params.inputs.map((name) => column(ctx.profile, name));
  const c = column(ctx.profile, params.result);
  const readA = orderedReader(a), readB = orderedReader(b), readC = orderedReader(c);
  const collector = new Collector();
  const symbol = params.formula === "sum" ? "+" : "×";
  let tested = 0;
  data.rows.forEach((r, i) => {
    const x = readA(r[a.index] ?? ""), y = readB(r[b.index] ?? ""), z = readC(r[c.index] ?? "");
    if (x === null || y === null || z === null) return;
    tested++;
    const expected = params.formula === "sum" ? x + y : x * y;
    if (Math.abs(expected - z) > params.tolerance + 1e-9) {
      collector.add(fileRow(i), `${display(a, x)} ${symbol} ${display(b, y)} ≠ ${display(c, z)}`, `Expected ${display(c, Math.round(expected * 10000) / 10000)}, difference ${display(c, Math.round((z - expected) * 10000) / 10000)}`);
    }
  });
  return ruleCard(params, ctx, tested, collector, { Tolerance: params.tolerance });
}
