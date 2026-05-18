import { apiRequest } from "./client";
import type { FieldworkState } from "../types";

export const fieldworkApi = {
  get: (projectId: string) => apiRequest<FieldworkState>(`/api/projects/${projectId}/fieldwork`),
  update: (projectId: string, fieldwork: FieldworkState) =>
    apiRequest<FieldworkState>(`/api/projects/${projectId}/fieldwork`, { method: "PUT", body: JSON.stringify(fieldwork) }),
  createFromPlanning: (projectId: string, mode: "keep" | "missing" | "replace" = "missing") =>
    apiRequest<FieldworkState>(`/api/projects/${projectId}/fieldwork/create-from-planning`, {
      method: "POST",
      body: JSON.stringify({ mode })
    })
};
