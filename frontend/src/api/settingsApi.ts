import { apiRequest } from "./client";

export type LlmSettings = {
  provider: string;
  model: string;
  demo_mode: boolean;
  ollama_base_url: string;
  openai_configured: boolean;
  anthropic_configured: boolean;
};

export type LlmSettingsUpdate = {
  provider: string;
  model?: string;
  demo_mode?: boolean;
  openai_api_key?: string;
  anthropic_api_key?: string;
};

export type RuntimeSettings = {
  deploymentMode: "local" | "hosted";
  isAdmin: boolean;
  adminEnabled: boolean;
  llmProviderConfigured: boolean;
  agentExecutionEnabled: boolean;
};

export type AgentRunLoggingSettings = {
  enabled: boolean;
  full_io: boolean;
  raw_response: boolean;
  retention_days: number;
  log_directory: string;
  hosted_full_logs_allowed: boolean;
  can_modify: boolean;
};

export const settingsApi = {
  get: () => apiRequest<LlmSettings>("/api/settings/llm"),
  runtime: () => apiRequest<RuntimeSettings>("/api/settings/runtime"),
  update: (payload: LlmSettingsUpdate) =>
    apiRequest<LlmSettings>("/api/settings/llm", { method: "PUT", body: JSON.stringify(payload) }),
  test: () => apiRequest<{ ok: boolean; message: string }>("/api/settings/llm/test", { method: "POST" }),
  agentRunLogs: () => apiRequest<AgentRunLoggingSettings>("/api/settings/agent-run-logs"),
  updateAgentRunLogs: (payload: Pick<AgentRunLoggingSettings, "enabled" | "full_io" | "raw_response" | "retention_days">) =>
    apiRequest<AgentRunLoggingSettings>("/api/settings/agent-run-logs", { method: "PUT", body: JSON.stringify(payload) })
};
