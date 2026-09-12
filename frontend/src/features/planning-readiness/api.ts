import { apiRequest } from "../../api/client";
import type { PlanningReadinessResponse } from "./types";

export const planningReadinessApi = {
  readiness: (projectId: string) => apiRequest<PlanningReadinessResponse>(`/api/projects/${projectId}/planning/readiness`),
  runReadinessReview: (projectId: string) =>
    apiRequest<PlanningReadinessResponse>(`/api/projects/${projectId}/planning/readiness/ai-review`, { method: "POST" })
};
