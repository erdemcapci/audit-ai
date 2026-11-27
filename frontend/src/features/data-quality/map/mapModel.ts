import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { AppliedAiPlan } from "../engine/aiPlan";
import { AI_VERDICT_LABEL, type AiInterpretation } from "../engine/interpretation";
import { TYPE_LABEL } from "../engine/profile";
import { isFinding, VERDICT_LABEL } from "../engine/runner";
import { TEMPLATES } from "../engine/templates/registry";
import type { ColumnInfo, Relationship, RunTotals, Severity, TemplateId, TestDefinition, TestNodeResult, Verdict } from "../engine/types";

/*
 * The run map: one node per step of the run, and one per test template (never per column, so the map
 * stays readable on wide files). The map is the visual face of the run log.
 */

export type MapNodeKind = "source" | "profile" | "discovery" | "ai" | "plan" | "test" | "exceptions" | "interpretation" | "result";
export type MapNodeState = "pending" | "running" | "done" | "not_applicable" | "switched_off";

export type MapNodeData = {
  kind: MapNodeKind;
  actor: "File" | "Code" | "AI" | "Auditor" | "Result";
  title: string;
  subtitle: string;
  state: MapNodeState;
  severity?: Severity;
  template?: TemplateId;
};

export type MapInput = {
  fileName: string;
  rows: number;
  columns: ColumnInfo[];
  /** Undefined for runs saved before relationship discovery existed: no discovery node then. */
  relationships?: Relationship[];
  plan: TestDefinition[];
  /** Null while the tests are running. */
  tests: TestNodeResult[] | null;
  progress?: Partial<Record<TemplateId, "running" | "done">>;
  /** The AI review of the plan, when one was used. */
  ai?: AppliedAiPlan | null;
  /** The AI interpretation of the results, when one was made. */
  interpretation?: AiInterpretation | null;
  totals?: RunTotals;
  verdict?: Verdict;
};

const STEP = 290;
const ROW = 96;
const worst = (severities: Severity[]): Severity => (["high", "medium", "low"] as const).find((s) => severities.includes(s)) ?? "clean";
const n = (value: number) => value.toLocaleString("en-US");

export function buildMap(input: MapInput): { nodes: Node<MapNodeData>[]; edges: Edge[] } {
  const height = (TEMPLATES.length - 1) * ROW;
  const middle = height / 2;
  const typeCounts = new Map<string, number>();
  input.columns.forEach((c) => typeCounts.set(TYPE_LABEL[c.type], (typeCounts.get(TYPE_LABEL[c.type]) ?? 0) + 1));
  const enabled = input.plan.filter((t) => t.enabled).length;
  const off = input.plan.length - enabled;
  const done = input.tests !== null;

  const relationships = input.relationships;
  const ai = input.ai;
  const aiChanges = ai ? ai.switchedOff.length + ai.switchedOn.length + ai.addedRules.length : 0;
  // The steps before the tests, left to right; optional steps only appear when they happened.
  const chain: [string, MapNodeData][] = [
    ["source", { kind: "source", actor: "File", title: input.fileName, subtitle: `${n(input.rows)} rows · ${n(input.columns.length)} columns`, state: "done" }],
    ["profile", { kind: "profile", actor: "Code", title: "Column profile", subtitle: [...typeCounts.entries()].map(([type, count]) => `${count} ${type.toLowerCase()}`).join(" · "), state: "done" }],
    ...(relationships ? [["discovery", { kind: "discovery", actor: "Code", title: "Relationship discovery", subtitle: relationships.length ? `${n(relationships.length)} relationship${relationships.length === 1 ? "" : "s"} found` : "No relationships found", state: "done" }] as [string, MapNodeData]] : []),
    ...(ai ? [["ai", { kind: "ai", actor: "AI", title: ai.response.demo ? "AI test plan (demo)" : "AI test plan", subtitle: aiChanges ? `${n(aiChanges)} change${aiChanges === 1 ? "" : "s"} proposed` : "No changes proposed", state: "done" }] as [string, MapNodeData]] : []),
    ["plan", { kind: "plan", actor: "Auditor", title: "Test plan", subtitle: `${n(enabled)} tests${off ? ` · ${n(off)} switched off` : ""}`, state: "done" }]
  ];
  const nodes: Node<MapNodeData>[] = chain.map(([id, data], i) => node(id, i * STEP, middle, data));
  const testX = chain.length * STEP + 10;

  TEMPLATES.forEach((template, i) => {
    const result = input.tests?.find((t) => t.template === template.id);
    const planned = input.plan.filter((t) => t.template === template.id);
    let state: MapNodeState;
    let subtitle: string;
    let severity: Severity | undefined;
    const unit = template.id === "rule" ? "rule" : "column";
    if (result) {
      state = result.status === "done" ? "done" : result.status;
      const found = result.cards.filter(isFinding);
      const toConfirm = result.cards.filter((c) => c.classification === "uncertain").length;
      severity = result.status === "done" ? worst(found.map((c) => c.severity)) : undefined;
      subtitle = result.status === "not_applicable" ? "Not applicable"
        : result.status === "switched_off" ? "Switched off"
        : `${result.cards.length === 1 && result.cards[0].subject === "Whole dataset" ? "Whole file" : `${n(result.cards.length)} ${unit}${result.cards.length === 1 ? "" : "s"}`} · ${found.length ? `${n(found.length)} with findings` : "clean"}${toConfirm ? ` · ${n(toConfirm)} to confirm` : ""}`;
    } else {
      const active = planned.filter((t) => t.enabled).length;
      state = !planned.length ? "not_applicable" : !active ? "switched_off" : input.progress?.[template.id] ?? "pending";
      subtitle = state === "not_applicable" ? "Not applicable" : state === "switched_off" ? "Switched off" : `${n(active)} ${unit}${active === 1 ? "" : "s"} · ${state === "running" ? "running…" : state === "done" ? "done" : "waiting"}`;
    }
    nodes.push(node(`test:${template.id}`, testX, i * ROW, { kind: "test", actor: "Code", title: template.title, subtitle, state, severity, template: template.id }));
  });

  const totals = input.totals;
  nodes.push(node("exceptions", testX + 330, middle, {
    kind: "exceptions", actor: "Code", title: "Exceptions",
    subtitle: totals ? `${totals.findings ? `${n(totals.findings)} finding${totals.findings === 1 ? "" : "s"} · ${n(totals.exceptions)} record${totals.exceptions === 1 ? "" : "s"}` : "No exceptions"}${totals.uncertain ? ` · ${n(totals.uncertain)} to confirm` : ""}` : "Waiting for tests",
    state: done ? "done" : "pending",
    severity: totals ? (totals.high ? "high" : totals.medium ? "medium" : totals.low ? "low" : "clean") : undefined
  }));
  const interpretation = input.interpretation;
  // Both reports are built from the exceptions: side by side in the last column, not one behind the other.
  const reportY = interpretation ? middle - ROW / 2 - 6 : middle;
  if (interpretation) {
    nodes.push(node("interpretation", testX + 620, middle + ROW / 2 + 6, {
      kind: "interpretation", actor: "AI", title: interpretation.demo ? "AI interpretation (demo)" : "AI interpretation",
      subtitle: `${AI_VERDICT_LABEL[interpretation.verdict]} · ${n(interpretation.client_questions.length)} question${interpretation.client_questions.length === 1 ? "" : "s"} for the client`, state: "done"
    }));
  }
  nodes.push(node("result", testX + 620, reportY, { kind: "result", actor: "Result", title: "Result report", subtitle: input.verdict ? VERDICT_LABEL[input.verdict] : "Waiting for tests", state: done ? "done" : "pending" }));

  const edge = (source: string, target: string, dim = false): Edge => ({
    id: `${source}->${target}`, source, target, type: "smoothstep", animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: { stroke: dim ? "#cbd5e1" : "#64748b", strokeWidth: dim ? 1 : 1.5, strokeDasharray: dim ? "4 4" : undefined }
  });
  const tail = interpretation ? [edge("exceptions", "result"), edge("exceptions", "interpretation")] : [edge("exceptions", "result")];
  const edges: Edge[] = [...chain.slice(1).map(([id], i) => edge(chain[i][0], id)), ...tail];
  nodes.filter((nd) => nd.data.kind === "test").forEach((nd) => {
    const inactive = nd.data.state === "not_applicable" || nd.data.state === "switched_off";
    edges.push(edge("plan", nd.id, inactive));
    if (!inactive) edges.push(edge(nd.id, "exceptions", nd.data.state !== "done"));
  });
  return { nodes, edges };
}

function node(id: string, x: number, y: number, data: MapNodeData): Node<MapNodeData> {
  return { id, type: "dqStep", position: { x, y }, data, draggable: false, connectable: false };
}
