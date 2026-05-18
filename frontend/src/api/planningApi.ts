import { apiRequest } from "./client";
import type { PlanningState } from "../types";

export const planningApi = {
  get: (projectId: string) => apiRequest<PlanningState>(`/api/projects/${projectId}/planning`),
  update: (projectId: string, planning: PlanningState) =>
    apiRequest<PlanningState>(`/api/projects/${projectId}/planning`, { method: "PUT", body: JSON.stringify(planning) }),
  generateObjectives: (projectId: string) =>
    apiRequest<PlanningState>(`/api/projects/${projectId}/planning/generate-objectives`, { method: "POST" }),
  generateRisks: (projectId: string) =>
    apiRequest<PlanningState>(`/api/projects/${projectId}/planning/generate-risks`, { method: "POST" }),
  generateTests: (projectId: string) =>
    apiRequest<PlanningState>(`/api/projects/${projectId}/planning/generate-tests`, { method: "POST" }),
  approve: (projectId: string) => apiRequest<PlanningState>(`/api/projects/${projectId}/planning/approve`, { method: "POST" }),
  reopen: (projectId: string) => apiRequest<PlanningState>(`/api/projects/${projectId}/planning/reopen`, { method: "POST" })
};
