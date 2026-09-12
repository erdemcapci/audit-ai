// Browser-only hook integration checks using React's existing test act helper.
// Run Vite and open /tests/readiness-browser.html; no provider or project writes.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { planningReadinessApi } from "../src/features/planning-readiness/api";
import { usePlanningReadiness } from "../src/features/planning-readiness/usePlanningReadiness";
import type { PlanningReadinessResponse } from "../src/features/planning-readiness/types";
import type { PlanningState } from "../src/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const results = document.getElementById("results")!;
const root = createRoot(document.getElementById("probe")!);
let latest: ReturnType<typeof usePlanningReadiness>;
const reads: Array<ReturnType<typeof deferred>> = [];
const reviews: Array<ReturnType<typeof deferred>> = [];
const calls: string[] = [];
const originalApi = { ...planningReadinessApi };
const passed: string[] = [];

function deferred() {
  let resolve!: (value: PlanningReadinessResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<PlanningReadinessResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function check(value: unknown, name: string) {
  if (!value) throw new Error(name);
  passed.push(name);
}
function response(fingerprint: string): PlanningReadinessResponse {
  return { plan_fingerprint: fingerprint, deterministic: { score: 75, max_score: 100, status: "mostly_ready", summary: "Review plan.", findings: [], category_counts: {}, severity_counts: {} }, ai_review: null, ai_error: null, weights: { deterministic: 0.65, ai: 0.35 }, overall_score: null, overall_status: "awaiting_ai_review", overall_explanation: "Awaiting review." };
}
function Probe({ projectId, planning }: { projectId: string; planning: PlanningState }) {
  latest = usePlanningReadiness(projectId, planning);
  return <p>{latest.readiness?.plan_fingerprint || "Pending"}</p>;
}
planningReadinessApi.readiness = (id) => {
  calls.push(id);
  const request = deferred(); reads.push(request); return request.promise;
};
planningReadinessApi.runReadinessReview = () => {
  const request = deferred(); reviews.push(request); return request.promise;
};

async function run() {
  const planning: PlanningState = { version: 1, stage: "empty", approved: false, workstreams: [], assumptions: [], open_questions: [] };
  await act(async () => { root.render(<Probe projectId="audit_1" planning={planning} />); });
  check(latest.readinessLoading && reads.length === 1, "initial mount starts readiness load");
  await act(async () => { reads[0].resolve(response("first")); });
  check(!latest.readinessLoading && latest.readiness?.plan_fingerprint === "first", "initial response updates readiness");
  await act(async () => { root.render(<Probe projectId="audit_1" planning={{ ...planning }} />); });
  check(reads.length === 2, "planning changes refresh readiness");
  await act(async () => { root.render(<Probe projectId="audit_2" planning={planning} />); });
  check(calls[2] === "audit_2", "project changes request the current project");
  await act(async () => { reads[1].resolve(response("cancelled")); });
  check(latest.readiness?.plan_fingerprint === "first" && latest.readinessLoading, "cancelled load cannot overwrite state or clear loading");
  await act(async () => { reads[2].resolve(response("second")); });
  check(latest.readiness?.plan_fingerprint === "second" && !latest.readinessLoading, "current project load completes");
  let review!: Promise<void>;
  await act(async () => { review = latest.runReadinessReview(); });
  check(latest.readinessRunning && latest.readinessError === "", "review starts and clears errors");
  await act(async () => { reviews[0].resolve(response("reviewed")); await review; });
  check(!latest.readinessRunning && latest.readiness?.plan_fingerprint === "reviewed", "review success updates readiness");
  await act(async () => { review = latest.runReadinessReview(); });
  await act(async () => { reviews[1].reject(new Error("Provider unavailable")); await review; });
  check(latest.readinessError === "Provider unavailable" && !latest.readinessRunning && latest.readiness?.plan_fingerprint === "reviewed", "review failure preserves the last review and exposes the error");
  let refresh!: Promise<void>;
  await act(async () => { refresh = latest.refreshReadiness(); });
  await act(async () => { reads[3].resolve(response("saved")); await refresh; });
  check(latest.readiness?.plan_fingerprint === "saved", "save-triggered refresh updates readiness");
  await act(async () => { root.render(<Probe projectId="audit_2" planning={{ ...planning }} />); });
  await act(async () => { reads[4].reject(new Error("Load unavailable")); });
  check(latest.readinessError === "Load unavailable" && !latest.readinessLoading, "load failure exposes the error and clears loading");
  await act(async () => { root.render(<Probe projectId="audit_2" planning={{ ...planning }} />); });
  await act(async () => { root.unmount(); });
  await act(async () => { reads[5].resolve(response("after-unmount")); });
  check(latest.readiness?.plan_fingerprint === "saved", "unmounted load is cancelled");
  results.textContent = `PASS: ${passed.length} lifecycle checks\n\n${passed.join("\n")}`;
}
run().catch((error) => { results.textContent = `FAIL: ${error.message}\n\nPassed:\n${passed.join("\n")}`; }).finally(() => Object.assign(planningReadinessApi, originalApi));
