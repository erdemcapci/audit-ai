import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { scenarios, current, pending } from "./readiness-fixtures.mjs";

let server;
let Panel;
before(async () => {
  server = await createServer({ configFile: false, define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") }, plugins: [react()], server: { middlewareMode: true, ws: false }, appType: "custom" });
  ({ PlanningReadinessPanel: Panel } = await server.ssrLoadModule("/src/features/planning-readiness/PlanningReadinessPanel.tsx"));
});
after(async () => { await server?.close(); });

test("management summary prioritizes decisions, actions and affected cards", () => {
  const html = renderToStaticMarkup(createElement(Panel, { ...scenarios.current,
    artifactLabels: { "risk-1": "Approval risk" }, onOpenArtifact: () => {} }));
  assert.match(html, /Overall plan status/);
  assert.match(html, /AI review/);
  assert.match(html, /Deterministic/);
  assert.match(html, /readiness-ai-score[^>]*>[\s\S]*?<strong>80 /);
  assert.match(html, /readiness-checks-score[^>]*>[\s\S]*?<strong>75 /);
  assert.match(html, /Combined readiness score: 76.8/);
  assert.match(html, /Needs attention/);
  assert.doesNotMatch(html, /readiness-management-message|Biggest concern|combined assessment weights/);
  assert.match(html, /Recommended improvement/);
  assert.match(html, /Show on audit map/);
  assert.match(html, /Readiness dimensions/);
});

test("loading, failed, stale, running and disabled states stay explicit", () => {
  const render = (props) => renderToStaticMarkup(createElement(Panel, props));
  assert.match(render(scenarios.loading), /Loading readiness/);
  assert.match(render(scenarios.pending), /Preliminary plan status: Needs attention/);
  assert.match(render(scenarios.stale), /previous plan and do not contribute/);
  assert.match(render(scenarios.stale), /Review outdated/);
  assert.match(render(scenarios.pending), /Not reviewed yet/);
  assert.match(render(scenarios.failed), /Review unavailable/);
  assert.match(render(scenarios.failed), /Provider failed/);
  assert.match(render(scenarios.running), /Reviewing/);
  assert.match(render(scenarios.disabled), /disabled=""/);
  const missing = render({ ...scenarios.current, onOpenArtifact: () => {} });
  assert.doesNotMatch(missing, /Show on audit map|readiness-map-action/);
});

test("decision statuses use score thresholds and severity overrides", async () => {
  const { summarizeReadiness } = await server.ssrLoadModule("/src/features/planning-readiness/summary.ts");
  const clean = structuredClone(current);
  clean.deterministic.findings = [];
  clean.ai_review.warnings = [];
  for (const [score, status] of [[95, "Ready"], [90, "Ready"], [89.9, "Ready with improvements"], [75, "Ready with improvements"], [74.9, "Needs attention"], [55, "Needs attention"], [54.9, "Not ready"]]) {
    assert.equal(summarizeReadiness({ ...clean, overall_score: score }).status, status);
  }
  const high = { ...clean, overall_score: 99, deterministic: pending.deterministic };
  assert.equal(summarizeReadiness(high).status, "Needs attention");
  high.deterministic = structuredClone(pending.deterministic);
  high.deterministic.findings[0].severity = "critical";
  assert.equal(summarizeReadiness(high).status, "Not ready");
  high.deterministic.findings[0].severity = "low";
  assert.equal(summarizeReadiness(high).status, "Ready with improvements");
});

test("repeated findings merge conservatively, preserving distinct affected scopes", async () => {
  const { summarizeReadiness } = await server.ssrLoadModule("/src/features/planning-readiness/summary.ts");
  const value = structuredClone(current);
  const duplicate = { ...value.ai_review.warnings[0], explanation: "  A risk has no tests.  ", severity: "high", priority: "Critical" };
  value.ai_review.warnings = [duplicate];
  value.ai_review.prioritized_recommendations = [{ ...duplicate, id: "recommendation-1" }];
  const before = JSON.stringify(value);
  const result = summarizeReadiness(value);
  assert.equal(result.findings.length, 1);
  assert.equal(result.important, 1);
  assert.deepEqual(result.findings[0].sources, ["Plan checks", "AI review"]);
  assert.equal(JSON.stringify(value), before, "summary must not mutate the saved review response");
  value.ai_review.warnings.push({ ...duplicate, id: "other-risk", affected_artifact_ids: ["risk-2"] });
  assert.equal(summarizeReadiness(value).important, 2);
});

test("pending and stale AI reviews cannot inflate current scores or issue counts", async () => {
  const { summarizeReadiness } = await server.ssrLoadModule("/src/features/planning-readiness/summary.ts");
  for (const props of [scenarios.pending, scenarios.stale, scenarios.failed]) {
    const result = summarizeReadiness(props.readiness);
    assert.equal(result.preliminary, true);
    assert.equal(result.score, pending.deterministic.score);
    assert.equal(result.findings.length, 1);
    assert.equal(result.important, 1);
  }
  const failedRerun = { ...current, ai_error: { error_message: "Failed rerun" } };
  assert.equal(summarizeReadiness(failedRerun).preliminary, false);
  assert.equal(summarizeReadiness(failedRerun).score, current.overall_score);
});

test("readiness API preserves endpoints, methods, credentials and compatibility exports", async () => {
  const { planningReadinessApi } = await server.ssrLoadModule("/src/features/planning-readiness/api.ts");
  const { planningApi } = await server.ssrLoadModule("/src/api/planningApi.ts");
  assert.equal(planningApi.readiness, planningReadinessApi.readiness);
  assert.equal(planningApi.runReadinessReview, planningReadinessApi.runReadinessReview);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ overall_status: "current" }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(await planningReadinessApi.readiness("audit_1"), { overall_status: "current" });
    await planningReadinessApi.runReadinessReview("audit_1");
    assert.equal(calls[0].url, "/api/projects/audit_1/planning/readiness");
    assert.equal(calls[0].options.method, undefined);
    assert.equal(calls[1].url, "/api/projects/audit_1/planning/readiness/ai-review");
    assert.equal(calls[1].options.method, "POST");
    assert.ok(calls.every(({ options }) => options.credentials === "include"));
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: "AI execution disabled." }), { status: 403 });
    await assert.rejects(planningReadinessApi.runReadinessReview("audit_1"), /AI execution disabled/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only valid references navigate and no raw ID is used as a label", () => {
  const readiness = structuredClone(pending);
  readiness.deterministic.findings[0].affected_artifact_ids = ["risk_2a66f67672", "obj_3665a6d198"];
  readiness.deterministic.findings[0].affected_artifact_names = ["Approval risk", ""];
  const html = renderToStaticMarkup(createElement(Panel, { ...scenarios.pending, readiness,
    artifactLabels: { "risk_2a66f67672": "risk_2a66f67672" }, onOpenArtifact: () => {} }));
  assert.match(html, /Show on audit map/);
  assert.match(html, /1 related plan item/);
  assert.doesNotMatch(html, /risk_2a66f67672|obj_3665a6d198/);
  const unavailable = renderToStaticMarkup(createElement(Panel, { ...scenarios.pending, readiness, onOpenArtifact: () => {} }));
  assert.doesNotMatch(unavailable, /readiness-map-action|related plan item|risk_2a66f67672|obj_3665a6d198/);
});

test("one compact action for 1, 3, 6, 12 and 20 artifacts with full reasoning retained", () => {
  for (const count of [1, 3, 6, 12, 20]) {
    const readiness = structuredClone(pending);
    const issue = readiness.deterministic.findings[0];
    issue.affected_artifact_ids = Array.from({ length: count }, (_, i) => `risk-${i}`);
    issue.explanation = "A short problem statement. " + "Full supporting reasoning. ".repeat(40);
    issue.recommended_action = "Improve evidence coverage. " + "Additional recommendation detail. ".repeat(30);
    const artifacts = Object.fromEntries(issue.affected_artifact_ids.map((id, index) => [id, { label: `Risk ${index}`, type: "riskNode", area: "Procurement" }]));
    const html = renderToStaticMarkup(createElement(Panel, { ...scenarios.pending, readiness, artifacts, onOpenArtifact: () => {}, onOpenArtifacts: () => {} }));
    assert.equal((html.match(/class="button button-secondary readiness-map-action"/g) || []).length, 1);
    assert.match(html, new RegExp(`${count} related plan item`));
    assert.match(html, new RegExp(`Risks \\(${count}\\)`));
    assert.doesNotMatch(html, /<details[^>]*open/);
    assert.ok(html.includes(issue.explanation));
    assert.ok(html.includes(issue.recommended_action));
    assert.match(html, /Affected areas/);
  }
});

test("area context follows planning ancestry without expanding implicated IDs", async () => {
  const { buildArtifactPresentations, findingArtifacts, conciseText } = await server.ssrLoadModule("/src/features/planning-readiness/presentation.ts");
  const node = (id, type, title) => ({ id, type, data: { title }, position: { x: 0, y: 0 } });
  const map = { nodes: [node("ws", "workstreamNode", "Procurement"), node("obj", "objectiveNode", "Approval controls"), node("risk", "riskNode", "Overrides"), node("test", "testNode", "Sample approvals"), node("agent", "agentNode", "Generator")], edges: [{ source: "ws", target: "obj" }, { source: "obj", target: "risk" }, { source: "risk", target: "test" }, { source: "risk", target: "agent" }] };
  const artifacts = buildArtifactPresentations(map, null);
  const result = findingArtifacts({ artifactIds: ["risk", "test", "risk", "deleted"], branch: "" }, artifacts);
  assert.deepEqual(result.ids, ["risk", "test"]);
  assert.deepEqual(result.areas, ["Procurement"]);
  assert.equal(artifacts.agent.area, "");
  const { summarizeReadiness } = await server.ssrLoadModule("/src/features/planning-readiness/summary.ts");
  const readiness = structuredClone(pending);
  readiness.deterministic.findings[0].navigation = { node_id: "obj" };
  assert.deepEqual(summarizeReadiness(readiness).findings[0].artifactIds, ["risk-1"]);
  readiness.deterministic.findings[0].affected_artifact_ids = [];
  assert.deepEqual(summarizeReadiness(readiness).findings[0].artifactIds, ["obj"]);
  assert.equal(conciseText("A short issue. " + "Long reasoning ".repeat(40)), "A short issue.");
});

test("AI-authored problem statement takes precedence over contextual reasoning", async () => {
  const readiness = structuredClone(current);
  const finding = readiness.ai_review.warnings[0];
  finding.concise_issue = "Planned tests do not verify vendor bank-account ownership before approval.";
  finding.explanation = "Vendor Due Diligence identifies validation of banking details as part of onboarding. However, the planned procedures omit bank-account ownership checks.";
  const html = renderToStaticMarkup(createElement(Panel, { ...scenarios.current, readiness }));
  assert.ok(html.includes(`<h4>${finding.concise_issue}</h4>`));
  assert.ok(html.includes(finding.explanation));
  assert.ok(!html.includes(`<h4>Vendor Due Diligence`));
  const { summarizeReadiness } = await server.ssrLoadModule("/src/features/planning-readiness/summary.ts");
  assert.equal(summarizeReadiness(readiness).score, current.overall_score);
  delete finding.concise_issue;
  assert.doesNotThrow(() => renderToStaticMarkup(createElement(Panel, { ...scenarios.current, readiness })));
});
