import { apiRequest } from "./client";
import type { AgentDefinition, AgentOutputCheckResponse, AgentRunMode, AgentState, AuditMapResponse } from "../types";

type AgentRunPayload = {
  input_node_ids?: string[];
  config?: Record<string, unknown>;
  prompt?: string;
  rough_finding_text?: string;
  temporary_content?: string;
  run_mode?: AgentRunMode;
};

export const agentsApi = {
  types: async () => {
    const payload = await apiRequest<unknown>("/api/agents/types");
    return Array.isArray(payload) ? (payload as AgentDefinition[]) : [];
  },
  create: (projectId: string, type: string, position?: { x: number; y: number }) =>
    apiRequest<AgentState>(`/api/projects/${projectId}/agents`, { method: "POST", body: JSON.stringify({ type, position }) }),
  update: (projectId: string, agentId: string, payload: Partial<Pick<AgentState, "title" | "prompt" | "config" | "position" | "status">>) =>
    apiRequest<AgentState>(`/api/projects/${projectId}/agents/${agentId}`, { method: "PUT", body: JSON.stringify(payload) }),
  checkOutputs: (projectId: string, agentId: string, payload: AgentRunPayload) =>
    apiRequest<AgentOutputCheckResponse>(`/api/projects/${projectId}/agents/${agentId}/output-check`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, ...payload })
    }),
  run: (projectId: string, agentId: string, payload: AgentRunPayload) =>
    apiRequest<{ agent: AgentState; generated: Record<string, unknown>; map: AuditMapResponse }>(`/api/projects/${projectId}/agents/${agentId}/run`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, ...payload })
    }),
  delete: (projectId: string, agentId: string) => apiRequest<{ message: string }>(`/api/projects/${projectId}/agents/${agentId}`, { method: "DELETE" })
};
