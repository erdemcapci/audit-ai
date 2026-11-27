import type { Dataset } from "./csv";
import { ruleId, ruleLabel, validateRule } from "./rules";
import { describeTest } from "./runner";
import type { DatasetProfile, RuleParams, TestDefinition } from "./types";

/*
 * AI review of the test plan (AI #1). The browser builds the request (profile summary, proposed tests,
 * a few sample rows) and applies the answer. Every proposal is checked against this file before it
 * enters the plan; anything that does not fit is kept as "rejected" with the reason, never run.
 */

export const SAMPLE_ROWS = 30;
const MAX_VALUE = 60;

export type AiPlanRequest = {
  file_name: string;
  rows: number;
  columns: { name: string; type: string; blank_percent: number; distinct: number; unique_percent: number; top_values: string[]; date_format: string; decimal: string }[];
  relationships: string[];
  tests: { id: string; template: string; subject: string; sentence: string; enabled: boolean; source: string }[];
  sample_rows: string[][];
};

export type AiPlanResponse = {
  summary: string;
  columns: { column: string; role: string; meaning: string }[];
  switch_off: { test_id: string; reason: string }[];
  switch_on: { test_id: string; reason: string }[];
  new_rules: { rule: Record<string, unknown>; reason: string; catches?: string }[];
  not_testable: { idea: string; reason: string }[];
  provider: string;
  model: string;
  demo: boolean;
  log_run_id: string | null;
  estimated_tokens: number;
  sample_rows_sent: number;
};

type Change = { testId: string; subject: string; reason: string };

/** What the AI review did to the plan; saved with the run as `ai_plan`. */
export type AppliedAiPlan = {
  requestedAt: string;
  durationMs: number;
  response: AiPlanResponse;
  switchedOff: Change[];
  switchedOn: Change[];
  addedRules: Change[];
  rejectedRules: { rule: string; reason: string; problem: string }[];
};

const cut = (value: string) => (value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value);

/** Rows spread evenly over the file, so a sorted export is still represented from start to end. */
function sampleRows(data: Dataset): string[][] {
  const n = data.rows.length;
  const count = Math.min(SAMPLE_ROWS, n);
  return Array.from({ length: count }, (_, k) => data.rows[Math.floor(((k + 0.5) * n) / count)].map(cut));
}

export function buildAiRequest(data: Dataset, profile: DatasetProfile, plan: TestDefinition[]): AiPlanRequest {
  return {
    file_name: data.name,
    rows: data.rows.length,
    columns: profile.columns.map((c) => ({
      name: c.name,
      type: c.type,
      blank_percent: Math.round(c.blankPercent * 10) / 10,
      distinct: c.distinct,
      unique_percent: Math.round(c.uniquePercent * 10) / 10,
      top_values: c.topValues.map((v) => cut(v.value)),
      date_format: c.date?.format ?? "",
      decimal: c.measure?.decimal ?? ""
    })),
    relationships: profile.relationships.map((r) => `${ruleLabel(r.rule)} (holds for ${(r.holdRate * 100).toFixed(1)}% of sampled rows)`),
    tests: plan.map((t) => ({ id: t.id, template: t.template, subject: t.subject, sentence: describeTest(t, profile), enabled: t.enabled, source: t.source })),
    sample_rows: sampleRows(data)
  };
}

/** Applies the AI answer to the plan. Pure: returns the new plan and a record of every change. */
export function applyAiPlan(plan: TestDefinition[], response: AiPlanResponse, profile: DatasetProfile, timing: { requestedAt: string; durationMs: number }): { plan: TestDefinition[]; applied: AppliedAiPlan } {
  const byId = new Map(plan.map((t) => [t.id, t]));
  const next = new Map(plan.map((t) => [t.id, { ...t }]));
  const applied: AppliedAiPlan = { ...timing, response, switchedOff: [], switchedOn: [], addedRules: [], rejectedRules: [] };

  for (const change of response.switch_off) {
    const test = next.get(change.test_id);
    if (!test || !test.enabled) continue;
    next.set(test.id, { ...test, enabled: false, aiNote: `AI switched this off: ${change.reason}` });
    applied.switchedOff.push({ testId: test.id, subject: test.subject, reason: change.reason });
  }
  for (const change of response.switch_on) {
    const test = next.get(change.test_id);
    if (!test || test.enabled) continue;
    next.set(test.id, { ...test, enabled: true, aiNote: `AI switched this on: ${change.reason}` });
    applied.switchedOn.push({ testId: test.id, subject: test.subject, reason: change.reason });
  }
  for (const proposal of response.new_rules) {
    const rule = proposal.rule as RuleParams;
    let problem = "";
    try {
      problem = validateRule(rule, profile)[0] ?? identifierValueList(rule, profile);
    } catch {
      problem = "The rule is incomplete.";
    }
    const label = problem ? JSON.stringify(proposal.rule) : ruleLabel(rule);
    if (problem) {
      applied.rejectedRules.push({ rule: label, reason: proposal.reason, problem });
      continue;
    }
    const id = ruleId(rule);
    const existing = next.get(id);
    if (existing) {
      if (!existing.enabled) {
        next.set(id, { ...existing, enabled: true, aiNote: `AI switched this on: ${proposal.reason}` });
        applied.switchedOn.push({ testId: id, subject: existing.subject, reason: proposal.reason });
      }
      continue;
    }
    next.set(id, { id, template: "rule", subject: label, params: rule, source: "ai", reason: proposal.reason || "Suggested by the AI review.", enabled: true });
    applied.addedRules.push({ testId: id, subject: label, reason: proposal.reason });
  }
  // Keep the original order; new rules go at the end.
  const ordered = [...plan.map((t) => next.get(t.id)!), ...[...next.values()].filter((t) => !byId.has(t.id))];
  return { plan: ordered, applied };
}

/**
 * An AI rule that names individual values of an identifier column (a tax number, an invoice number) copies
 * values from the sample rather than stating a business rule, so it is not used. An auditor's own rule may.
 */
function identifierValueList(rule: RuleParams, profile: DatasetProfile): string {
  if (rule.kind !== "conditional") return "";
  const listed = [rule.if, rule.then].find((c) => ["eq", "neq", "in", "not_in"].includes(c.op) && profile.columns.find((col) => col.name === c.column)?.type === "identifier");
  return listed ? `It lists individual values of “${listed.column}”, which holds identifiers; a rule should hold for any record, and the format test already checks how identifiers look.` : "";
}

/** Column meanings from the AI review, by column name. */
export function rolesOf(applied: AppliedAiPlan | null | undefined): Map<string, { role: string; meaning: string }> {
  return new Map((applied?.response.columns ?? []).map((c) => [c.column, { role: c.role, meaning: c.meaning }]));
}
