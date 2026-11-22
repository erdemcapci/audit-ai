import { TYPE_LABEL } from "./profile";
import { VERDICT_LABEL } from "./runner";
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
};

const n = (value: number) => value.toLocaleString("en-US");
const SEVERITY_TITLE: Record<Exclude<Severity, "clean">, string> = { high: "High severity", medium: "Medium severity", low: "Low severity" };

export function formatRunDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function buildReport(input: ReportInput): string {
  const { results } = input;
  const { totals } = results;
  const lines: string[] = [];
  const findings = results.tests.flatMap((t) => t.cards.filter((c) => c.exceptions > 0).map((c) => ({ test: t, card: c })));

  lines.push(`# Data quality report — ${input.fileName}`, "");
  lines.push(`- Run: ${formatRunDate(input.createdAt)}`);
  lines.push(`- File: ${input.fileName} · ${n(input.rows)} rows · ${n(input.columns.length)} columns`);
  lines.push(`- Result: **${VERDICT_LABEL[results.verdict]}** — ${n(totals.tests)} tests, ${n(totals.findings)} with findings (${n(totals.high)} high, ${n(totals.medium)} medium, ${n(totals.low)} low)`);
  lines.push("- Prepared by: automated standard tests. No AI was used.", "");

  lines.push("## Findings", "");
  if (!findings.length) lines.push("No test found any exceptions.", "");
  (["high", "medium", "low"] as const).forEach((severity) => {
    const group = findings.filter((f) => f.card.severity === severity);
    if (!group.length) return;
    lines.push(`### ${SEVERITY_TITLE[severity]}`, "");
    group.forEach(({ test, card }) => lines.push(`- **${test.title} — ${card.subject}:** ${card.summary}${examplesText(card)}`));
    lines.push("");
  });

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
  const formats = Object.entries(input.settings.dateFormats);
  if (formats.length) lines.push(`- Date formats confirmed: ${formats.map(([column, format]) => `${column} = ${format}`).join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

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
