import type { TestNodeResult } from "./types";

/*
 * AI interpretation of a run's results (AI #2), as saved by the backend. It sits next to the code's own
 * results: code severities, totals and the code verdict are never changed by it.
 */

export type AiVerdict = "usable" | "usable_with_conditions" | "not_usable";
export type AiAction = "ask_client" | "exclude_records" | "document_limitation" | "investigate_in_fieldwork" | "no_action";

export type AiCardInterpretation = {
  card_id: string;
  severity: "high" | "medium" | "low";
  severity_reason: string;
  meaning: string;
  action: AiAction;
  action_text: string;
  unverified_numbers: string[];
};

export type AiInterpretation = {
  verdict: AiVerdict;
  summary: string;
  cards: AiCardInterpretation[];
  client_questions: string[];
  limitations: string[];
  unverified_numbers: string[];
  provider: string;
  model: string;
  demo: boolean;
  log_run_id: string | null;
  estimated_tokens: number;
  cards_sent: number;
  attempts: number;
  created_at: string;
};

export const AI_VERDICT_LABEL: Record<AiVerdict, string> = {
  usable: "Usable",
  usable_with_conditions: "Usable with conditions",
  not_usable: "Not usable"
};

export const AI_ACTION_LABEL: Record<AiAction, string> = {
  ask_client: "Ask the client",
  exclude_records: "Exclude the records",
  document_limitation: "Record as a limitation",
  investigate_in_fieldwork: "Investigate in fieldwork",
  no_action: "No action"
};

export const interpretedBy = (ai: AiInterpretation) => (ai.demo ? "demo AI (fixed rules, no model)" : `AI (${ai.provider}${ai.model ? `, ${ai.model}` : ""})`);

export function cardInterpretations(ai: AiInterpretation | null | undefined): Map<string, AiCardInterpretation> {
  return new Map((ai?.cards ?? []).map((c) => [c.card_id, c]));
}

/** The interpretation as a compact Markdown section: verdict first, then questions, then one action per finding. */
export function interpretationMarkdown(ai: AiInterpretation, tests: TestNodeResult[]): string {
  const subjects = new Map(tests.flatMap((t) => t.cards.map((c) => [c.testId, `${t.title} — ${c.subject}`])));
  const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
  const lines = ["## AI interpretation", ""];
  lines.push(`**${AI_VERDICT_LABEL[ai.verdict]}.** ${ai.summary}`.trim(), "");
  lines.push(`_By ${interpretedBy(ai)}. The test results themselves were computed by the tests._`, "");
  const unverified = [...new Set([...ai.unverified_numbers, ...ai.cards.flatMap((c) => c.unverified_numbers)])];
  if (unverified.length) lines.push(`**Check before relying on it:** the AI used numbers that are not in the results (${unverified.join(", ")}).`, "");
  if (ai.client_questions.length) {
    lines.push("**Ask the client**", "");
    ai.client_questions.forEach((q) => lines.push(`- ${q}`));
    lines.push("");
  }
  if (ai.limitations.length) {
    lines.push("**Limitations**", "");
    ai.limitations.forEach((l) => lines.push(`- ${l}`));
    lines.push("");
  }
  if (ai.cards.length) {
    lines.push("## AI recommended actions", "");
    lines.push("| Finding | Severity | Action |", "| --- | --- | --- |");
    ai.cards.forEach((c) => lines.push(`| ${cell(subjects.get(c.card_id) ?? c.card_id)} | ${c.severity[0].toUpperCase()}${c.severity.slice(1)} | ${AI_ACTION_LABEL[c.action]}: ${cell(c.action_text)} |`));
    lines.push("");
    lines.push("## AI interpretation details", "");
    ai.cards.forEach((c) => lines.push(`- **${subjects.get(c.card_id) ?? c.card_id}** — ${c.meaning}`));
    lines.push("");
  }
  return lines.join("\n");
}

/** The report with the AI interpretation placed right after the summary, before the findings table. */
export function reportWithInterpretation(report: string, ai: AiInterpretation | null | undefined, tests: TestNodeResult[]): string {
  if (!ai) return report;
  // The summary's "No AI was used" is about the tests; with an interpretation it needs to say where the AI comes in.
  report = report.replace("automated standard tests. No AI was used._", "automated standard tests, not by AI. The AI interpretation follows._");
  const section = interpretationMarkdown(ai, tests);
  const at = report.indexOf("\n## Findings") >= 0 ? report.indexOf("\n## Findings") : report.indexOf("\n## ");
  return at < 0 ? `${report}\n${section}` : `${report.slice(0, at + 1)}${section}\n${report.slice(at + 1)}`;
}
