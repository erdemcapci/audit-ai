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
  assert.match(html, /Overall readiness/);
  assert.match(html, /76.8/);
  assert.match(html, /Needs attention/);
  assert.match(html, /1 important issue should be addressed before fieldwork/);
  assert.match(html, /Biggest concern/);
  assert.match(html, /Recommended improvement/);
  assert.match(html, /View Approval risk/);
  assert.match(html, /Readiness dimensions/);
});

test("loading, failed, stale, running and disabled states stay explicit", () => {
  const render = (props) => renderToStaticMarkup(createElement(Panel, props));
  assert.match(render(scenarios.loading), /Loading readiness/);
  assert.match(render(scenarios.pending), /Preliminary: Needs attention/);
  assert.match(render(scenarios.stale), /previous plan and do not contribute/);
  assert.match(render(scenarios.failed), /Provider failed/);
  assert.match(render(scenarios.running), /Reviewing/);
  assert.match(render(scenarios.disabled), /disabled=""/);
  const missing = render({ ...scenarios.current, onOpenArtifact: () => {} });
  assert.match(missing, /This card is not in the current audit plan/);
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
