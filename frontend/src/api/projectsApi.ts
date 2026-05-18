import { apiRequest } from "./client";
import type { AuditCreate, AuditProject, AuditMapResponse, AutoLayoutConfig, BulkDeleteRequest, MapStateUpdate } from "../types";

export const projectsApi = {
  create: (payload: AuditCreate) => apiRequest<AuditProject>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  list: () => apiRequest<AuditProject[]>("/api/projects"),
  get: (projectId: string) => apiRequest<AuditProject>(`/api/projects/${projectId}`),
  delete: (projectId: string) => apiRequest<{ message: string }>(`/api/projects/${projectId}`, { method: "DELETE" }),
  map: (projectId: string) => apiRequest<AuditMapResponse>(`/api/projects/${projectId}/audit-map`),
  updateMap: (projectId: string, payload: MapStateUpdate) =>
    apiRequest<MapStateUpdate>(`/api/projects/${projectId}/audit-map`, { method: "PUT", body: JSON.stringify(payload) }),
  autoLayout: (projectId: string, config?: AutoLayoutConfig) =>
    apiRequest<AuditMapResponse>(`/api/projects/${projectId}/audit-map/auto-layout`, { method: "POST", body: JSON.stringify(config || {}) }),
  bulkDelete: (projectId: string, payload: BulkDeleteRequest) =>
    apiRequest<AuditMapResponse>(`/api/projects/${projectId}/audit-map/bulk-delete`, { method: "POST", body: JSON.stringify(payload) }),
  updateNode: (projectId: string, nodeId: string, node_type: string, fields: Record<string, unknown>) =>
    apiRequest<AuditMapResponse>(`/api/projects/${projectId}/audit-map/nodes/${nodeId}`, { method: "PUT", body: JSON.stringify({ node_type, fields }) }),
  deleteNode: (projectId: string, nodeId: string) =>
    apiRequest<AuditMapResponse>(`/api/projects/${projectId}/audit-map/nodes/${nodeId}`, { method: "DELETE" }),
  deleteOutputs: (projectId: string, nodeId: string) =>
    apiRequest<AuditMapResponse>(`/api/projects/${projectId}/audit-map/nodes/${nodeId}/outputs`, { method: "DELETE" })
};
