import { decodeText, parseCsv, type Dataset } from "./csv";
import { buildProfile } from "./profile";
import { buildReport } from "./report";
import { planChanges, runPlan } from "./runner";
import { withDefaults, type ColumnInfo, type DatasetProfile, type PlanChange, type Relationship, type ResultCard, type RunResults, type RunSettings, type RunStep, type RunTotals, type TemplateId, type TestDefinition, type TestNodeResult, type Verdict } from "./types";

/*
 * Glue between the engine and a saved run: executes a plan with a step log, and turns the in-memory
 * results into the record the backend stores (no exception lists, no template detail objects).
 */

export const ENGINE_VERSION = 1;

export type SourceInfo = { name: string; size: number; rows: number; columns: number; headers: string[]; content_hash: string; stored: boolean };

export type RunRecordContent = {
  engine_version: number;
  settings: RunSettings;
  plan: TestDefinition[];
  /** `relationships` is missing in runs saved before relationship discovery existed. */
  profile: { rows: number; columns: ColumnInfo[]; relationships?: Relationship[]; discoveryNote?: string };
  steps: RunStep[];
  results: TestNodeResult[];
  report_markdown: string;
  source: SourceInfo;
  totals: RunTotals;
  verdict: Verdict;
  ai_used: boolean;
};

export type RunRecord = RunRecordContent & { id: string; created_at: string };

export type RunSummary = Pick<RunRecord, "id" | "created_at" | "source" | "totals" | "verdict" | "ai_used">;

export type LoadedSource = { bytes: ArrayBuffer; data: Dataset };

export function readSource(bytes: ArrayBuffer, name: string): LoadedSource {
  const data = parseCsv(decodeText(bytes), name);
  if (!data.headers.length || !data.rows.length) throw new Error("The file has no data rows.");
  return { bytes, data };
}

export type ExecutedRun = { profile: DatasetProfile; results: RunResults; steps: RunStep[]; changes: PlanChange[] };

/** Runs the plan and records every step: profile, the auditor's plan review, each test. */
export async function executeRun(
  data: Dataset,
  profile: DatasetProfile,
  standardPlan: TestDefinition[],
  plan: TestDefinition[],
  settings: RunSettings,
  timing: { loadedAt: string; loadMs: number; profileMs: number; reviewStartedAt: string },
  onProgress?: (template: TemplateId, state: "running" | "done") => void
): Promise<ExecutedRun> {
  const changes = planChanges(standardPlan, plan);
  const reviewEnded = new Date().toISOString();
  const steps: RunStep[] = [
    { id: "source", kind: "file", title: "Load file", startedAt: timing.loadedAt, durationMs: timing.loadMs, detail: { name: data.name, rows: data.rows.length, columns: data.headers.length } },
    { id: "profile", kind: "code", title: "Column profile", startedAt: timing.loadedAt, durationMs: timing.profileMs, detail: { columns: profile.columns.length } },
    { id: "discovery", kind: "code", title: "Relationship discovery", startedAt: timing.loadedAt, durationMs: 0, detail: { relationships: profile.relationships.length } },
    {
      id: "plan", kind: "auditor", title: "Test plan review", startedAt: timing.reviewStartedAt, durationMs: Date.parse(reviewEnded) - Date.parse(timing.reviewStartedAt),
      detail: { proposed: standardPlan.length, enabled: plan.filter((t) => t.enabled).length, changes }
    }
  ];
  const started: Record<string, string> = {};
  const results = await runPlan(data, profile, plan, settings, (template, state) => {
    if (state === "running") started[template] = new Date().toISOString();
    onProgress?.(template, state);
  });
  results.tests.forEach((t) => {
    if (t.status !== "done") return;
    steps.push({ id: `test:${t.template}`, kind: "code", title: t.title, startedAt: started[t.template] ?? reviewEnded, durationMs: t.durationMs, detail: { tests: t.cards.length, exceptions: t.cards.reduce((n, c) => n + c.exceptions, 0) } });
  });
  return { profile, results, steps, changes };
}

/** Re-executes a saved run from its source file. Same plan + same data = same results. */
export async function replayRun(record: RunRecord, data: Dataset): Promise<{ profile: DatasetProfile; results: RunResults }> {
  const settings = withDefaults(record.settings);
  const profile = buildProfile(data, settings);
  const results = await runPlan(data, profile, record.plan, settings);
  return { profile, results };
}

const stripCard = ({ records: _records, recordsCapped: _capped, detail: _detail, ...stored }: ResultCard): ResultCard => stored;

export function buildRecordContent(input: { source: SourceInfo; executed: ExecutedRun; plan: TestDefinition[]; settings: RunSettings; createdAt: string }): RunRecordContent {
  const { executed } = input;
  const report = buildReport({
    fileName: input.source.name, rows: executed.profile.rows, columns: executed.profile.columns, createdAt: input.createdAt,
    results: executed.results, settings: input.settings, changes: executed.changes
  });
  return {
    engine_version: ENGINE_VERSION,
    settings: input.settings,
    plan: input.plan,
    profile: { rows: executed.profile.rows, columns: executed.profile.columns, relationships: executed.profile.relationships, discoveryNote: executed.profile.discoveryNote },
    steps: [...executed.steps, { id: "report", kind: "code", title: "Result report", startedAt: new Date().toISOString(), durationMs: 0, detail: {} }],
    results: executed.results.tests.map((t) => ({ ...t, cards: t.cards.map(stripCard) })),
    report_markdown: report,
    source: input.source,
    totals: executed.results.totals,
    verdict: executed.results.verdict,
    ai_used: false
  };
}
