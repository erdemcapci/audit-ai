import { apiRequest } from "./client";

export type AgentRunLog = {
  run_id: string;
  project_id: string;
  actor_id: string;
  agent_id: string;
  agent_name: string;
  status: "started" | "success" | "error";
  started_at: string;
  completed_at: string | null;
  provider: string;
  model: string;
  selected_item_ids: string[];
  context_recipe_id: string;
  context_blocks_used: string[];
  estimated_context_tokens: number;
  context_truncated: boolean;
  output_object_ids: string[];
  error_message: string;
  full_io_logged: boolean;
  raw_response_logged: boolean;
  rendered_context?: string | null;
  final_prompt?: unknown;
  parsed_output?: unknown;
  raw_llm_response?: unknown;
};

export const agentRunsApi = {
  list: (projectId: string) => apiRequest<AgentRunLog[]>(`/api/projects/${projectId}/agent-runs`),
  get: (projectId: string, runId: string) => apiRequest<AgentRunLog>(`/api/projects/${projectId}/agent-runs/${runId}`),
  delete: (projectId: string, runId: string) =>
    apiRequest<{ message: string }>(`/api/projects/${projectId}/agent-runs/${runId}`, { method: "DELETE" })
};
