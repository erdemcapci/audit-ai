import type { Dataset } from "./csv";
import { getTemplate, TEMPLATES } from "./templates/registry";
import type { DatasetProfile, PlanChange, RunResults, RunSettings, RunTotals, Severity, TemplateId, TestDefinition, TestNodeResult, Verdict } from "./types";

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, clean: 3 };

/** The standard plan: every template's automatic tests for this profile. */
export function buildStandardPlan(profile: DatasetProfile, settings: RunSettings): TestDefinition[] {
  return TEMPLATES.flatMap((t) => t.autoInstances(profile, settings));
}

export function describeTest(test: TestDefinition): string {
  return getTemplate(test.template).describe(test);
}

/** What the auditor changed compared with the standard plan. */
export function planChanges(standard: TestDefinition[], final: TestDefinition[]): PlanChange[] {
  const before = new Map(standard.map((t) => [t.id, t]));
  return final.flatMap((t): PlanChange[] => {
    const original = before.get(t.id);
    const base = { testId: t.id, subject: t.subject, template: t.template };
    if (!original) return [{ ...base, change: "switched_on", detail: "Added" }];
    if (original.enabled !== t.enabled) return [{ ...base, change: t.enabled ? "switched_on" : "switched_off" }];
    if (JSON.stringify(original.params) !== JSON.stringify(t.params)) return [{ ...base, change: "changed", detail: describeTest(t) }];
    return [];
  });
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Runs every enabled test of the plan, one template at a time. Yields between templates so the page
 * can show progress; `onProgress` reports each template as it starts and finishes.
 */
export async function runPlan(
  data: Dataset,
  profile: DatasetProfile,
  plan: TestDefinition[],
  settings: RunSettings,
  onProgress?: (template: TemplateId, state: "running" | "done") => void
): Promise<RunResults> {
  const tests: TestNodeResult[] = [];
  for (const template of TEMPLATES) {
    const all = plan.filter((t) => t.template === template.id);
    const enabled = all.filter((t) => t.enabled);
    const base = { template: template.id, title: template.title, dimension: template.dimension, notes: template.notApplied?.(profile) ?? [] };
    if (!all.length) { tests.push({ ...base, status: "not_applicable", cards: [], durationMs: 0 }); continue; }
    if (!enabled.length) { tests.push({ ...base, status: "switched_off", cards: [], durationMs: 0 }); continue; }
    onProgress?.(template.id, "running");
    await yieldToBrowser();
    const started = performance.now();
    const cards = enabled
      .map((t) => template.run(data, t.params, { profile, settings, testId: t.id }))
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.rate - a.rate);
    const switchedOff = all.filter((t) => !t.enabled).map((t) => ({ subject: t.subject, reason: "Switched off in the test plan." }));
    tests.push({ ...base, notes: [...switchedOff, ...base.notes], status: "done", cards, durationMs: Math.round(performance.now() - started) });
    onProgress?.(template.id, "done");
  }
  const totals = totalsOf(tests);
  return { tests, totals, verdict: verdictOf(totals) };
}

export function totalsOf(tests: TestNodeResult[]): RunTotals {
  const cards = tests.flatMap((t) => t.cards);
  const found = cards.filter((c) => c.exceptions > 0);
  return {
    tests: cards.length,
    findings: found.length,
    high: found.filter((c) => c.severity === "high").length,
    medium: found.filter((c) => c.severity === "medium").length,
    low: found.filter((c) => c.severity === "low").length,
    exceptions: found.reduce((n, c) => n + c.exceptions, 0)
  };
}

/** Code-only verdict. It grades the findings; whether the data is fit for use is the auditor's call. */
export function verdictOf(totals: RunTotals): Verdict {
  if (totals.high) return "significant_issues";
  if (totals.findings) return "issues_to_review";
  return "no_issues";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  no_issues: "No issues found",
  issues_to_review: "Issues to review",
  significant_issues: "Significant issues"
};
