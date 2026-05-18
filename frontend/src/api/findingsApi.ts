import { apiRequest } from "./client";
import type { Finding, FindingsState } from "../types";

export const findingsApi = {
  get: (projectId: string) => apiRequest<FindingsState>(`/api/projects/${projectId}/findings`),
  update: (projectId: string, findings: FindingsState) =>
    apiRequest<FindingsState>(`/api/projects/${projectId}/findings`, { method: "PUT", body: JSON.stringify(findings) }),
  create: (projectId: string, finding: Finding) =>
    apiRequest<Finding>(`/api/projects/${projectId}/findings`, { method: "POST", body: JSON.stringify(finding) }),
  refine: (projectId: string, raw_description: string, fieldwork_item_id?: string) =>
    apiRequest<Finding>(`/api/projects/${projectId}/findings/refine`, {
      method: "POST",
      body: JSON.stringify({ raw_description, fieldwork_item_id: fieldwork_item_id || null })
    }),
  delete: (projectId: string, findingId: string) =>
    apiRequest<{ status: string }>(`/api/projects/${projectId}/findings/${findingId}`, { method: "DELETE" }),
  draft: (projectId: string, raw_description: string, fieldwork_item_id?: string) =>
    apiRequest<Finding>(`/api/projects/${projectId}/findings/draft`, {
      method: "POST",
      body: JSON.stringify({ raw_description, fieldwork_item_id: fieldwork_item_id || null })
    })
};
