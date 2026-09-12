import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { scenarios } from "./readiness-fixtures.mjs";

let server;
let Panel;
before(async () => {
  server = await createServer({ configFile: false, define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") }, plugins: [react()], server: { middlewareMode: true, ws: false }, appType: "custom" });
  ({ PlanningReadinessPanel: Panel } = await server.ssrLoadModule("/src/features/planning-readiness/PlanningReadinessPanel.tsx"));
});
after(async () => { await server?.close(); });

test("readiness presentation matches the original planning page in seven states", async () => {
  // Hashes captured from the original public/main JSX, using the same props.
  const expected = JSON.parse(await readFile(new URL("./readiness-markup.json", import.meta.url), "utf8"));
  for (const [name, props] of Object.entries(scenarios)) {
    const html = renderToStaticMarkup(createElement(Panel, props));
    assert.equal(createHash("sha256").update(html).digest("hex"), expected[name], name);
  }
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
