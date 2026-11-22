import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

/* AI interpretation in the report: placed before the findings, labelled, with unverified numbers flagged. */

let server, interpretation;
before(async () => {
  server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, ws: false }, appType: "custom" });
  interpretation = await server.ssrLoadModule("/src/features/data-quality/engine/interpretation.ts");
});
after(async () => { await server?.close(); });

const ai = {
  verdict: "usable_with_conditions",
  summary: "Usable once 98 duplicate invoice numbers are explained.",
  cards: [{ card_id: "uniqueness.key:invoice_number", severity: "high", severity_reason: "Duplicates can mean double payments.", meaning: "Some invoice numbers repeat.", action: "ask_client", action_text: "Ask why.", unverified_numbers: [] }],
  client_questions: ["Why do 98 invoice numbers appear twice?"],
  limitations: ["Weekend dates could not be tested."],
  unverified_numbers: ["777"],
  provider: "claude", model: "claude-x", demo: false, log_run_id: "run_1", estimated_tokens: 900, cards_sent: 3, attempts: 2, created_at: ""
};
const tests = [{ template: "uniqueness.key", title: "Duplicate keys", cards: [{ testId: "uniqueness.key:invoice_number", subject: "invoice_number" }] }];
const report = "# Data quality report — x.csv\n\n- Run: today\n\n## Findings\n\n- something\n";

test("the interpretation goes right after the report header, before the findings", () => {
  const md = interpretation.reportWithInterpretation(report, ai, tests);
  assert.ok(md.indexOf("## AI interpretation") < md.indexOf("## Findings"));
  assert.ok(md.startsWith("# Data quality report — x.csv\n\n- Run: today\n"));
  assert.match(md, /Verdict: \*\*Usable with conditions\*\* \(by AI \(claude, claude-x\)/);
  assert.match(md, /### Questions for the client\n\n- Why do 98 invoice numbers appear twice\?/);
  assert.match(md, /\*\*Duplicate keys — invoice_number\*\* \(AI: high\) — Some invoice numbers repeat\. Ask the client: Ask why\./);
  assert.match(md, /numbers that are not in the results \(777\)/);
});

test("without an interpretation the report is unchanged", () => {
  assert.equal(interpretation.reportWithInterpretation(report, null, tests), report);
});
