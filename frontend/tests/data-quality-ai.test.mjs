import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

/*
 * AI review of the test plan: what is sent, how the answer is applied, and that nothing the AI
 * proposes runs unless it fits the file. The answer here is a fixed object; no model is called.
 */

let server, csv, profileMod, runner, session, types, aiPlan, rules;
before(async () => {
  server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, ws: false }, appType: "custom" });
  const load = (path) => server.ssrLoadModule(`/src/features/data-quality/engine/${path}`);
  [csv, profileMod, runner, session, types, aiPlan, rules] = await Promise.all(["csv.ts", "profile.ts", "runner.ts", "session.ts", "types.ts", "aiPlan.ts", "rules.ts"].map(load));
});
after(async () => { await server?.close(); });

function fixture() {
  const lines = ["invoice_no,customer_id,status,close_date,amount,batch,note"];
  for (let i = 0; i < 200; i++) {
    const closed = i % 2 === 0;
    lines.push([`INV${1000 + i}`, `C${i % 20}`, closed ? "Closed" : "Open", closed ? "2024-03-01" : "", (100 + i).toFixed(2), `B${i % 50}`, "x".repeat(i === 3 ? 200 : 10)].join(","));
  }
  lines[6] = lines[6].replace(",Open,,", ",Open,2024-03-02,"); // open with a close date
  return csv.parseCsv(lines.join("\n"), "ai.csv");
}

function setup() {
  const data = fixture();
  const profile = profileMod.buildProfile(data, types.DEFAULT_SETTINGS);
  const plan = runner.buildStandardPlan(profile, types.DEFAULT_SETTINGS);
  return { data, profile, plan };
}

const answer = (plan, overrides = {}) => ({
  summary: "Invoices with their status.",
  columns: [{ column: "invoice_no", role: "document_number", meaning: "Invoice number" }],
  switch_off: [{ test_id: plan.find((t) => t.template === "completeness.blank" && t.subject === "note").id, reason: "Notes are optional." }],
  switch_on: [],
  new_rules: [
    { rule: { kind: "conditional", if: { column: "status", op: "eq", value: "Closed" }, then: { column: "amount", op: "gte", value: "100" } }, reason: "Closed invoices are at least 100." },
    { rule: { kind: "compare", left: "close_date", op: "lte", right: "nope" }, reason: "Uses a column that does not exist." },
    { rule: { kind: "conditional", if: { column: "status" } }, reason: "Incomplete." }
  ],
  not_testable: [{ idea: "Same customer and amount within three days", reason: "Needs a time window." }],
  provider: "fake", model: "fake-1", demo: false, log_run_id: "run_x", estimated_tokens: 1200, sample_rows_sent: 30,
  ...overrides
});

test("the request carries the profile, the plan and at most 30 shortened sample rows", () => {
  const { data, profile, plan } = setup();
  const request = aiPlan.buildAiRequest(data, profile, plan);
  assert.equal(request.sample_rows.length, 30);
  assert.ok(request.sample_rows.every((row) => row.length === data.headers.length && row.every((v) => v.length <= 61)));
  assert.equal(request.sample_rows[0][0], data.rows[3][0], "rows are spread over the whole file");
  assert.equal(request.columns.length, data.headers.length);
  assert.equal(request.tests.length, plan.length);
  assert.ok(request.tests.every((t) => t.sentence.length > 10));
  assert.ok(request.sample_rows.flat().includes("INV1003"), "values are sent as they are, not masked");
});

test("AI changes are applied, and proposals that do not fit the file are rejected, not run", () => {
  const { profile, plan } = setup();
  const { plan: next, applied } = aiPlan.applyAiPlan(plan, answer(plan), profile, { requestedAt: "2026-11-22T10:00:00Z", durationMs: 1500 });
  const note = next.find((t) => t.id === "completeness.blank:note");
  assert.equal(note.enabled, false);
  assert.match(note.aiNote, /^AI switched this off: Notes are optional\./);
  const added = next.find((t) => t.source === "ai");
  assert.equal(added.subject, "status = Closed ⇒ amount ≥ 100");
  assert.equal(added.enabled, true);
  assert.deepEqual(applied.rejectedRules.map((r) => r.problem), ["Choose a column that exists in this file.", "The rule is incomplete."]);
  assert.equal(next.length, plan.length + 1);
  assert.deepEqual(next.slice(0, plan.length).map((t) => t.id), plan.map((t) => t.id), "the original order is kept");
});

test("a proposed rule that is already in the plan but off is switched on instead of duplicated", () => {
  const { profile, plan } = setup();
  const rule = { kind: "dependency", from: "invoice_no", to: "customer_id" };
  const withRule = [...plan, { id: rules.ruleId(rule), template: "rule", subject: rules.ruleLabel(rule), params: rule, source: "discovered", reason: "", enabled: false }];
  const { plan: next, applied } = aiPlan.applyAiPlan(withRule, answer(withRule, { switch_off: [], new_rules: [{ rule, reason: "One customer per invoice." }] }), profile, { requestedAt: "", durationMs: 0 });
  assert.equal(next.filter((t) => t.id === rules.ruleId(rule)).length, 1);
  assert.equal(next.find((t) => t.id === rules.ruleId(rule)).enabled, true);
  assert.equal(applied.switchedOn.length, 1);
});

test("a run with an AI review records the AI step, the AI rule results and the report section", async () => {
  const { data, profile, plan } = setup();
  const { plan: afterAi, applied } = aiPlan.applyAiPlan(plan, answer(plan), profile, { requestedAt: "2026-11-22T10:00:00Z", durationMs: 1500 });
  const final = afterAi.map((t) => (t.id === "completeness.blank:amount" ? { ...t, enabled: false } : t)); // the auditor's own change
  const executed = await session.executeRun(data, profile, afterAi, final, types.DEFAULT_SETTINGS, { loadedAt: "2026-11-22T09:59:00Z", loadMs: 5, profileMs: 5, reviewStartedAt: "2026-11-22T09:59:30Z", ai: applied });
  const step = executed.steps.find((s) => s.id === "ai_plan");
  assert.equal(step.kind, "ai");
  assert.equal(step.detail.added_rules, 1);
  assert.deepEqual(executed.changes.map((c) => c.testId), ["completeness.blank:amount"], "only the auditor's own change counts as a change");
  const ruleCards = executed.results.tests.find((t) => t.template === "rule").cards;
  assert.equal(ruleCards.find((c) => c.subject === "status = Closed ⇒ amount ≥ 100").classification, "holds", "the AI rule ran");
  assert.equal(ruleCards.find((c) => c.subject === "close_date filled ⇒ status ∈ {Closed}").exceptions, 1, "discovery already proposed the close-date rule");

  const content = session.buildRecordContent({ source: { name: "ai.csv", size: 1, rows: 200, columns: 7, headers: data.headers, content_hash: "", stored: true }, executed, plan: final, settings: types.DEFAULT_SETTINGS, createdAt: "2026-11-22T10:01:00Z" });
  assert.equal(content.ai_used, true);
  assert.equal(content.ai_plan.addedRules.length, 1);
  assert.match(content.report_markdown, /reviewed by AI \(fake, fake-1\)/);
  assert.match(content.report_markdown, /## AI review of the test plan[\s\S]*Rule added: status = Closed ⇒ amount ≥ 100/);
  assert.match(content.report_markdown, /Idea for fieldwork: Same customer and amount within three days/);
});

test("without an AI review the run says so", async () => {
  const { data, profile, plan } = setup();
  const executed = await session.executeRun(data, profile, plan, plan, types.DEFAULT_SETTINGS, { loadedAt: "", loadMs: 0, profileMs: 0, reviewStartedAt: "2026-11-22T10:00:00Z" });
  const content = session.buildRecordContent({ source: { name: "ai.csv", size: 1, rows: 200, columns: 7, headers: data.headers, content_hash: "", stored: true }, executed, plan, settings: types.DEFAULT_SETTINGS, createdAt: "2026-11-22T10:01:00Z" });
  assert.equal(content.ai_used, false);
  assert.equal(content.ai_plan, null);
  assert.ok(!executed.steps.some((s) => s.kind === "ai"));
  assert.match(content.report_markdown, /No AI was used/);
});
