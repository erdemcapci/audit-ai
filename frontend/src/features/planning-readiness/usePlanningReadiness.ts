import { useEffect, useState } from "react";
import type { PlanningState } from "../../types";
import { planningReadinessApi } from "./api";
import type { PlanningReadinessResponse } from "./types";

// Mounted by the planning editor, preserving its refresh/cancellation lifecycle.
export function usePlanningReadiness(projectId: string, planning: PlanningState) {
  const [readiness, setReadiness] = useState<PlanningReadinessResponse | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessRunning, setReadinessRunning] = useState(false);
  const [readinessError, setReadinessError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setReadinessLoading(true);
    setReadinessError("");
    planningReadinessApi.readiness(projectId)
      .then((result) => {
        if (!cancelled) setReadiness(result);
      })
      .catch((err) => {
        if (!cancelled) setReadinessError(err instanceof Error ? err.message : "Unable to load planning readiness.");
      })
      .finally(() => {
        if (!cancelled) setReadinessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planning]);

  async function refreshReadiness() {
    const next = await planningReadinessApi.readiness(projectId);
    setReadiness(next);
  }

  async function runReadinessReview() {
    setReadinessRunning(true);
    setReadinessError("");
    try {
      const next = await planningReadinessApi.runReadinessReview(projectId);
      setReadiness(next);
    } catch (err) {
      setReadinessError(err instanceof Error ? err.message : "Unable to run AI Planning Review.");
    } finally {
      setReadinessRunning(false);
    }
  }

  return { readiness, readinessLoading, readinessRunning, readinessError, refreshReadiness, runReadinessReview };
}
