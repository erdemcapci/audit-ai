// Real workspace, canvas and inspector; isolated in-memory API fixtures only.
import { createRoot } from "react-dom/client";
import { AuditWorkspace } from "../src/screens/AuditWorkspace";
import "../src/styles/global.css";
import "../src/styles/flow.css";

const results = document.getElementById("results")!;
const passed: string[] = [];
const pause = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
function check(value: unknown, name: string) { if (!value) throw new Error(name); passed.push(name); }
const text = () => document.getElementById("probe")!.textContent || "";
function button(label: string, within: ParentNode = document) {
  const found = Array.from(within.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string, within?: ParentNode) { button(label, within).click(); await pause(); }
const finding = (id: string, severity: string, ids: string[], explanation: string) => ({
  id, check_name: id, category: "Coverage", severity, explanation,
  recommended_action: `Improve ${id}.`, affected_artifact_ids: ids, affected_artifact_names: [], branch: "Approvals"
});
const groupIds = ["ws-1", "obj-1", "risk-1", "ws-2", "obj-2", "risk-2"];
const largeIds = [...groupIds, ...Array.from({ length: 14 }, (_, i) => `test-${i}`)];
const longReasoning = "Two areas lack sufficient audit evidence. " + "Full supporting explanation remains available. ".repeat(30);
const current = {
  plan_fingerprint: "p1", weights: { deterministic: 0.65, ai: 0.35 }, overall_score: 78,
  overall_status: "current", overall_explanation: "Combined", ai_error: null as null | { error_message: string },
  deterministic: { score: 80, max_score: 100, status: "mostly_ready", summary: "Review coverage.", category_counts: {}, severity_counts: {}, findings: [
    finding("Plan scope", "low", [], "Clarify the plan scope."),
    finding("Single gap", "high", ["risk-1"], "Approval evidence is missing."),
    finding("Shared gap", "medium", [...groupIds, "risk-1", "risk_deadbeef00"], longReasoning),
    finding("Large gap", "low", largeIds, "Many procedures need clearer expected evidence.")
  ] },
  ai_review: { score: 74.3, provider: "fixture", model: "fixture", reviewed_at: "2026-09-12T10:00:00Z", stale: false,
    executive_summary: "Coverage needs attention.", strengths: [], dimension_scores: [{ dimension: "Coverage", score: 75, explanation: "Some missing coverage." }],
    critical_gaps: [], warnings: [], duplication_findings: [], contradiction_findings: [], missing_coverage_findings: [], improvement_opportunities: [], prioritized_recommendations: [] }
};
let assessment: Record<string, unknown> = structuredClone(current);
let reruns = 0;
let savedTitle = "";
const map = { nodes: [1, 2].map((n) => ({ id: `risk-${n}`, type: "riskNode", position: { x: (n - 1) * 1800, y: 200 }, width: 560, height: 260,
  data: { title: n === 1 ? "Approval risk" : "Payment risk", description: "Review evidence", phase: "planning", status: "Draft", severity: "High" } })), edges: [{ id: "ws1-obj1", source: "ws-1", target: "obj-1" }, { id: "obj1-risk1", source: "obj-1", target: "risk-1" }, { id: "ws2-obj2", source: "ws-2", target: "obj-2" }, { id: "obj2-risk2", source: "obj-2", target: "risk-2" }] };
for (let n = 1; n <= 2; n++) {
  map.nodes.push({ id: `ws-${n}`, type: "workstreamNode", position: { x: (n - 1) * 1800, y: -600 }, width: 560, height: 260, data: { title: n === 1 ? "Vendor Due Diligence" : "Vendor Master Setup", description: "Area context", phase: "planning", status: "Draft", severity: "" } });
  map.nodes.push({ id: `obj-${n}`, type: "objectiveNode", position: { x: (n - 1) * 1800, y: -200 }, width: 560, height: 260, data: { title: `Objective ${n}`, description: "Objective context", phase: "planning", status: "Draft", severity: "" } });
}
for (let i = 0; i < 14; i++) map.nodes.push({ id: `test-${i}`, type: "testNode", position: { x: (i % 4) * 700, y: 600 + Math.floor(i / 4) * 350 }, width: 560, height: 260, data: { title: `Procedure ${i + 1}`, description: "Inspect audit evidence", phase: "planning", status: "Draft", severity: "" } });
const planning = { version: 1, stage: "draft", approved: false, workstreams: [], assumptions: [], open_questions: [] };
globalThis.fetch = async (input, init) => {
  const path = new URL(String(input), location.href).pathname;
  let body: unknown;
  if (path.endsWith("/planning/readiness/ai-review")) {
    reruns++;
    assessment = { ...structuredClone(current), overall_score: 92, ai_review: { ...current.ai_review, score: 86.4 }, deterministic: { ...current.deterministic, score: 95, findings: [] } };
    body = assessment;
  } else if (path.endsWith("/planning/readiness")) body = assessment;
  else if (path.includes("/audit-map/nodes/")) {
    const fields = JSON.parse(String(init?.body)).fields;
    const node = map.nodes.find((n) => path.endsWith(`/${n.id}`))!;
    Object.assign(node.data, fields); savedTitle = fields.title; body = map;
  } else if (path.endsWith("/audit-map")) body = map;
  else if (path.endsWith("/planning")) body = planning;
  else if (path.endsWith("/agents/types")) body = [];
  else if (path.endsWith("/fieldwork")) body = { items: [] };
  else if (path.endsWith("/findings")) body = { findings: [] };
  else if (path.endsWith("/reports")) body = {};
  else if (path === "/api/projects/ux-fixture") body = { id: "ux-fixture", title: "Readiness UX fixture", locked: false };
  else throw new Error(`Unexpected API request: ${path}`);
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
async function openReadiness() { await click("Readiness"); }
async function verifyTarget(id: string, title: string) {
  const selected = document.querySelector(`.react-flow__node[data-id="${id}"].selected`);
  check(selected, `${id}: exact map card is selected`);
  check(document.querySelector(".detail-panel input")?.getAttribute("value") === title, `${id}: existing inspector opens for correct card`);
  const bounds = selected!.getBoundingClientRect();
  const canvas = document.querySelector(".react-flow")!.getBoundingClientRect();
  check(bounds.width > 100 && bounds.left >= canvas.left - 2 && bounds.right <= canvas.right + 2 && bounds.top >= canvas.top - 2 && bounds.bottom <= canvas.bottom + 2,
    `${id}: viewport focuses entire target card at usable scale`);
  const inspector = document.querySelector(".map-overlay-panel")!.getBoundingClientRect();
  check(bounds.right <= inspector.left - 8, `${id}: focused card is not obscured by inspector`);
}
function verifyGroup(ids: string[]) {
  check(!document.querySelector(".detail-panel"), "group navigation closes inspector");
  const emphasized = Array.from(document.querySelectorAll(".readiness-node-emphasis"));
  check(emphasized.length === ids.length && emphasized.every((node) => ids.includes(node.getAttribute("data-id")!)), `${ids.length} cards: only explicitly implicated artifacts emphasized`);
  const canvas = document.querySelector(".react-flow")!.getBoundingClientRect();
  check(emphasized.every((node) => { const bounds = node.getBoundingClientRect(); return bounds.width > 0 && bounds.left >= canvas.left - 2 && bounds.right <= canvas.right + 2 && bounds.top >= canvas.top - 2 && bounds.bottom <= canvas.bottom + 2; }), `${ids.length} cards: entire affected group fits viewport`);
}
async function run() {
  createRoot(document.getElementById("probe")!).render(<AuditWorkspace projectId="ux-fixture" onReset={() => {}} runtime={null} />);
  await pause(1000);
  check(button("Readiness"), "Readiness tab visible in workspace");
  check(!Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Audit Plan"), "legacy planning editor remains hidden");
  await openReadiness();
  check(text().includes("Audit Plan Readiness"), "Readiness screen opens");
  check(document.querySelector(".readiness-management-score > strong")?.textContent === "78 / 100", "existing overall score displays correctly");
  check(text().includes("Needs attention"), "decision status visible");
  check(text().includes("1 important issue"), "important issue count correct");
  check(document.querySelector(".readiness-management-message")?.textContent?.includes("Biggest concernApproval evidence is missing."), "biggest concern is highest priority issue");
  const cards = Array.from(document.querySelectorAll(".readiness-finding"));
  check(cards.map((c) => c.querySelector("h4")?.textContent).join(",") === "Single gap,Shared gap,Plan scope,Large gap", "findings sorted high to medium to low");
  check(cards[0].textContent?.includes("Improve Single gap."), "recommendation rendered");
  check(cards[1].querySelectorAll(".readiness-map-action").length === 1 && button("Show 6 affected items on map", cards[1]), "six valid artifacts have one primary action; duplicates and missing IDs excluded");
  const related = cards[1].querySelector(".readiness-related") as HTMLDetailsElement;
  const details = cards[1].querySelector(".readiness-finding-details") as HTMLDetailsElement;
  check(!related.open && !details.open, "related items and reasoning collapsed by default");
  check(cards[1].getBoundingClientRect().height < 520, "long reasoning stays compact by default");
  check(cards[1].querySelector(".readiness-areas")?.textContent?.includes("Vendor Due Diligence · Vendor Master Setup"), "higher-level areas derived from hierarchy");
  related.querySelector("summary")!.click(); await pause();
  check(related.open && related.textContent?.includes("Workstreams (2)") && related.textContent?.includes("Objectives (2)") && related.textContent?.includes("Risks (2)"), "related items expand and group by actual node types");
  related.querySelector("summary")!.click();
  details.querySelector("summary")!.click(); await pause();
  check(details.open && details.textContent?.includes(longReasoning), "Details exposes complete original reasoning");
  details.querySelector("summary")!.click();
  check(!details.open && !related.open, "both secondary sections collapse again");
  check(!cards[1].textContent?.includes("risk_deadbeef00"), "invalid internal reference never shown");
  check(cards[2].querySelectorAll("button").length === 0 && !cards[2].querySelector(".readiness-related"), "plan-level finding has no broken navigation action");
  const summary = document.querySelector(".readiness-management-summary")!.getBoundingClientRect();
  check(summary.width > 700 && summary.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth, `${innerWidth}px desktop: summary fits without horizontal overflow`);
  await click("Show on audit map", cards[0]);
  await verifyTarget("risk-1", "Approval risk");
  const input = document.querySelector(".detail-panel input") as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Updated approval risk");
  input.dispatchEvent(new Event("input", { bubbles: true })); await pause();
  await click("Save Card");
  check(savedTitle === "Updated approval risk" && text().includes(savedTitle), "existing card edit saves through workspace and refreshes map");
  await openReadiness();
  await click("Show 6 affected items on map");
  verifyGroup(groupIds);
  document.querySelector<HTMLElement>('.react-flow__node[data-id="risk-2"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  document.querySelector<HTMLElement>('.react-flow__node[data-id="risk-2"]')!.click(); await pause();
  check(!document.querySelector(".readiness-node-emphasis"), "normal map interaction clears temporary group emphasis");
  check(document.querySelector(".detail-panel"), "normal map interaction opens inspector after group navigation");
  await openReadiness();
  const sharedRelated = document.querySelectorAll<HTMLDetailsElement>(".readiness-related")[1];
  sharedRelated.querySelector("summary")!.click(); await pause();
  await click("Payment risk ↗", sharedRelated);
  await verifyTarget("risk-2", "Payment risk");
  await openReadiness();
  const singleRelated = document.querySelector<HTMLDetailsElement>(".readiness-related")!;
  singleRelated.querySelector("summary")!.click(); await pause();
  await click("Updated approval risk ↗", singleRelated);
  await verifyTarget("risk-1", "Updated approval risk");
  await openReadiness();
  const largeCard = Array.from(document.querySelectorAll(".readiness-finding")).find((card) => card.querySelector("h4")?.textContent === "Large gap")!;
  check(largeCard.querySelectorAll(".readiness-map-action").length === 1 && largeCard.getBoundingClientRect().height < 520, "twenty-artifact finding has one compact primary action");
  const largeRelated = largeCard.querySelector<HTMLDetailsElement>(".readiness-related")!;
  largeRelated.querySelector("summary")!.click(); await pause();
  const list = largeRelated.querySelector<HTMLElement>(".readiness-related-list")!;
  check(list.scrollHeight > list.clientHeight && list.clientHeight <= 280, "large expanded artifact list scrolls compactly");
  await click("Show 20 affected items on map");
  verifyGroup(largeIds);
  await openReadiness();
  check(!document.querySelector<HTMLDetailsElement>(".readiness-related")!.open, "returning to Readiness restores compact cards");
  await click("Map");
  document.querySelector<HTMLElement>('.react-flow__node[data-id="risk-2"]')!.click(); await pause();
  check(document.querySelector('.react-flow__node[data-id="risk-2"].selected'), "ordinary map selection works after readiness navigation");
  assessment = { ...structuredClone(current), ai_review: null, overall_score: null, overall_status: "awaiting_ai_review" };
  await openReadiness();
  check(text().includes("Preliminary: Needs attention") && text().includes("Plan checks · overall pending"), "preliminary result distinguished from overall readiness");
  await click("Map");
  assessment = { ...structuredClone(current), ai_review: { ...current.ai_review, stale: true }, overall_score: null, overall_status: "stale_ai_review" };
  await openReadiness();
  check(text().includes("plan has changed") && text().includes("Previous AI review — outdated"), "stale result clearly distinguished");
  await click("Run AI Review Again");
  check(reruns === 1 && text().includes("Ready") && !text().includes("Preliminary:") && document.querySelector(".readiness-management-score > strong")?.textContent === "92 / 100", "rerunning updates visible score and removes stale state");
  await click("Map");
  assessment = { ...structuredClone(current), ai_error: { error_message: "Provider unavailable" } };
  await openReadiness();
  check(text().includes("Latest AI review failed: Provider unavailable") && text().includes("last successful review still matches"), "AI failure explained while retaining current result");
  results.textContent = `PASS: ${passed.length} workspace checks\n${passed.join("\n")}`;
}
run().catch((error) => { results.textContent = `FAIL: ${error.message}\nPassed ${passed.length}:\n${passed.join("\n")}`; });
