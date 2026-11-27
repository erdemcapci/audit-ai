import type { AppliedAiPlan } from "./aiPlan";
import { TYPE_LABEL } from "./profile";
import { isFinding, VERDICT_LABEL } from "./runner";
import { getTemplate } from "./templates/registry";
import type { ColumnInfo, PlanChange, ResultCard, RunResults, RunSettings, Severity, TestNodeResult } from "./types";

/*
 * Plain-language result report, built from template sentences only (no AI). Saved with the run and
 * exported as Markdown. Kept to headings, bullet lists and paragraphs so it reads well anywhere.
 */

export type ReportInput = {
  fileName: string;
  rows: number;
  columns: ColumnInfo[];
  createdAt: string;
  results: RunResults;
  settings: RunSettings;
  changes: PlanChange[];
  ai?: AppliedAiPlan | null;
};

const n = (value: number) => value.toLocaleString("en-US");

export function formatRunDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function buildReport(input: ReportInput): string {
  const { results } = input;
  const { totals } = results;
  const lines: string[] = [];
  const findings = results.tests.flatMap((t) => t.cards.filter(isFinding).map((c) => ({ test: t, card: c })));
  const rules = results.tests.flatMap((t) => t.cards);
  const toConfirm = rules.filter((c) => c.classification === "uncertain");
  const notHeld = rules.filter((c) => c.classification === "rule_did_not_hold");

  const ai = input.ai;
  const ranked = [...findings].sort((a, b) => SEVERITY_ORDER[a.card.severity] - SEVERITY_ORDER[b.card.severity] || b.card.exceptions - a.card.exceptions);

  lines.push(`# Data quality report — ${input.fileName}`, "");
  lines.push(`${n(input.rows)} rows · ${n(input.columns.length)} columns · ${formatRunDate(input.createdAt)}`, "");

  lines.push("## Summary", "");
  lines.push(`**${VERDICT_LABEL[results.verdict]}.** ${n(totals.findings)} of ${n(totals.tests)} tests found exceptions: ${n(totals.high)} high, ${n(totals.medium)} medium, ${n(totals.low)} low.`, "");
  if (ranked.length) {
    lines.push("**Top issues**", "");
    ranked.slice(0, TOP_ISSUES).forEach(({ test, card }, i) => lines.push(`${i + 1}. ${severityTag(card.severity)} ${test.title} — ${card.subject}: ${n(card.exceptions)} ${card.exceptions === 1 ? "record" : "records"} (${shareText(card.rate)})`));
    if (ranked.length > TOP_ISSUES) lines.push(`_…and ${n(ranked.length - TOP_ISSUES)} more in the findings table below._`);
    lines.push("");
  }
  if (totals.uncertain) lines.push(`**To confirm:** ${n(totals.uncertain)} rule${totals.uncertain === 1 ? "" : "s"} broken by many rows — check with the client before relying on ${totals.uncertain === 1 ? "it" : "them"}.`, "");
  lines.push(ai
    ? `_Results computed by tests, not AI. Test plan reviewed by ${ai.response.demo ? "the demo AI (fixed rules, no model)" : `AI (${ai.response.provider}${ai.response.model ? `, ${ai.response.model}` : ""})`} and approved by the auditor._`
    : "_Results computed by automated standard tests. No AI was used._", "");

  lines.push("## Findings", "");
  if (!findings.length) lines.push("No test found any exceptions.", "");
  else {
    lines.push("| Severity | Test | Column | Exceptions | Share | Example |", "| --- | --- | --- | ---: | ---: | --- |");
    ranked.forEach(({ test, card }) => lines.push(`| ${card.severity[0].toUpperCase()}${card.severity.slice(1)} | ${cell(test.title)} | ${cell(card.subject)} | ${n(card.exceptions)} | ${shareText(card.rate)} | ${cell(firstExample(card))} |`));
    lines.push("");
    lines.push("## Finding details", "");
    ranked.forEach(({ test, card }) => lines.push(`- **${test.title} — ${card.subject}:** ${card.summary}${examplesText(card)}`));
    lines.push("");
  }

  if (toConfirm.length) {
    lines.push("## Rules to confirm", "", "These rules are broken by too many rows to treat the rows as exceptions. Confirm with the client whether each rule applies before relying on it.", "");
    toConfirm.forEach((c) => lines.push(`- **${c.subject}:** ${c.summary}`));
    lines.push("");
  }
  if (notHeld.length) {
    lines.push("## Assumptions that did not hold", "", "Not findings: the data does not follow these rules, so they were probably wrong for this file.", "");
    notHeld.forEach((c) => lines.push(`- ${c.subject}: ${c.summary}`));
    lines.push("");
  }

  lines.push("## Tests without findings", "");
  const clean = results.tests.filter((t) => t.status === "done" && t.cards.some((c) => c.exceptions === 0));
  if (!clean.length) lines.push("Every test that ran found at least one exception.");
  clean.forEach((t) => {
    const subjects = t.cards.filter((c) => c.exceptions === 0).map((c) => c.subject);
    lines.push(`- ${t.title}: ${subjects.length === 1 ? subjects[0] : `${n(subjects.length)} columns`}`);
  });
  lines.push("");

  lines.push("## Not tested", "");
  const notTested = notTestedLines(results.tests);
  if (!notTested.length) lines.push("Every test applied to this file.");
  lines.push(...notTested, "");

  if (ai) {
    lines.push("## AI review of the test plan", "");
    if (ai.response.summary) lines.push(ai.response.summary, "");
    ai.switchedOff.forEach((c) => lines.push(`- Switched off: ${c.subject} — ${c.reason}`));
    ai.switchedOn.forEach((c) => lines.push(`- Switched on: ${c.subject} — ${c.reason}`));
    ai.addedRules.forEach((c) => lines.push(`- Rule added: ${c.subject} — ${c.reason}`));
    ai.rejectedRules.forEach((c) => lines.push(`- Proposal not used: ${c.problem} (${c.reason})`));
    ai.response.not_testable.forEach((c) => lines.push(`- Idea for fieldwork: ${c.idea}${c.reason ? ` — ${c.reason}` : ""}`));
    if (!ai.switchedOff.length && !ai.switchedOn.length && !ai.addedRules.length && !ai.response.not_testable.length) lines.push("- The AI review proposed no changes.");
    lines.push("");
  }

  if (input.changes.length) {
    lines.push("## Changes to the standard plan", "");
    input.changes.forEach((c) => lines.push(`- ${getTemplate(c.template).title} — ${c.subject}: ${c.change === "switched_off" ? "switched off" : c.change === "switched_on" ? "switched on" : `changed (${c.detail})`}`));
    lines.push("");
  }

  lines.push("## Columns", "");
  input.columns.forEach((c) => lines.push(`- ${c.name}: ${TYPE_LABEL[c.type]}, ${c.blankPercent.toFixed(1)}% blank`));
  lines.push("");

  lines.push("## Settings", "");
  lines.push(`- Blank tolerance: ${input.settings.blankThresholdPercent}%`);
  lines.push(`- Rare-pattern threshold: ${input.settings.patternThresholdPercent}%`);
  lines.push(`- Unusual amounts: more than ${input.settings.outlierFactor} × the interquartile range outside the middle half`);
  lines.push(`- Rules: up to ${input.settings.ruleFindingMaxPercent}% of rows breaking a rule are findings, up to ${input.settings.ruleUncertainMaxPercent}% the rule is to be confirmed, above that it did not hold`);
  lines.push(`- Relationships proposed as rules when they hold for at least ${input.settings.discoveryMinHoldPercent}% of sampled rows`);
  const formats = Object.entries(input.settings.dateFormats);
  if (formats.length) lines.push(`- Date formats confirmed: ${formats.map(([column, format]) => `${column} = ${format}`).join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, clean: 3 };
const TOP_ISSUES = 5;
const severityTag = (severity: Severity) => `**${severity === "clean" ? "" : severity.toUpperCase()}**`;
const shareText = (rate: number) => `${rate >= 10 ? rate.toFixed(0) : rate >= 1 ? rate.toFixed(1) : rate.toFixed(2)}%`;
/** Table cells cannot contain pipes or line breaks. */
const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const firstExample = (card: ResultCard) => {
  const value = card.examples.map((e) => e.value.trim()).find(Boolean);
  return value ? `“${value.length > 28 ? `${value.slice(0, 27)}…` : value}”` : "";
};

function examplesText(card: ResultCard) {
  const values = [...new Set(card.examples.map((e) => e.value.trim()).filter(Boolean))].slice(0, 3);
  return values.length ? ` Examples: ${values.map((v) => `“${v}”`).join(", ")}.` : "";
}

function notTestedLines(tests: TestNodeResult[]) {
  return tests.flatMap((t) => {
    const template = getTemplate(t.template);
    if (t.status === "not_applicable") return [`- ${t.title}: not applicable — applies to ${template.appliesTo.toLowerCase()}.`];
    if (t.status === "switched_off") return [`- ${t.title}: switched off in the test plan.`];
    const off = t.notes.filter((note) => note.reason.startsWith("Switched off"));
    return off.length ? [`- ${t.title}: switched off for ${off.map((o) => o.subject).join(", ")}.`] : [];
  });
}
