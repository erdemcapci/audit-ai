import { apiRequest } from "./client";
import type { AuditCreate, AuditProject, AuditMapResponse, AutoLayoutConfig, BulkDeleteRequest, MapStateUpdate } from "../types";

function normalizeMapResponse(payload: unknown): AuditMapResponse {
  const candidate = (payload || {}) as Record<string, unknown>;
  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
  const edges = Array.isArray(candidate.edges) ? candidate.edges : [];
  return { nodes, edges } as AuditMapResponse;
}

function normalizeProjectList(payload: unknown): AuditProject[] {
  return Array.isArray(payload) ? (payload as AuditProject[]) : [];
}

export const projectsApi = {
  create: (payload: AuditCreate) => apiRequest<AuditProject>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  list: async () => normalizeProjectList(await apiRequest<unknown>("/api/projects")),
  get: (projectId: string) => apiRequest<AuditProject>(`/api/projects/${projectId}`),
  delete: (projectId: string) => apiRequest<{ message: string }>(`/api/projects/${projectId}`, { method: "DELETE" }),
  map: async (projectId: string) =>
    normalizeMapResponse(await apiRequest<unknown>(`/api/projects/${projectId}/audit-map`)),
  updateMap: (projectId: string, payload: MapStateUpdate) =>
    apiRequest<MapStateUpdate>(`/api/projects/${projectId}/audit-map`, { method: "PUT", body: JSON.stringify(payload) }),
  autoLayout: async (projectId: string, config?: AutoLayoutConfig) =>
    normalizeMapResponse(
      await apiRequest<unknown>(`/api/projects/${projectId}/audit-map/auto-layout`, { method: "POST", body: JSON.stringify(config || {}) })
    ),
  bulkDelete: async (projectId: string, payload: BulkDeleteRequest) =>
    normalizeMapResponse(
      await apiRequest<unknown>(`/api/projects/${projectId}/audit-map/bulk-delete`, { method: "POST", body: JSON.stringify(payload) })
    ),
  updateNode: (projectId: string, nodeId: string, node_type: string, fields: Record<string, unknown>) =>
    apiRequest<unknown>(`/api/projects/${projectId}/audit-map/nodes/${nodeId}`, { method: "PUT", body: JSON.stringify({ node_type, fields }) }).then(
      normalizeMapResponse
    ),
  deleteNode: (projectId: string, nodeId: string) =>
    apiRequest<unknown>(`/api/projects/${projectId}/audit-map/nodes/${nodeId}`, { method: "DELETE" }).then(normalizeMapResponse),
  deleteOutputs: (projectId: string, nodeId: string) =>
    apiRequest<unknown>(`/api/projects/${projectId}/audit-map/nodes/${nodeId}/outputs`, { method: "DELETE" }).then(normalizeMapResponse)
};
