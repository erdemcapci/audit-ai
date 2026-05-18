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

export const settingsApi = {
  get: () => apiRequest<LlmSettings>("/api/settings/llm"),
  update: (payload: LlmSettingsUpdate) =>
    apiRequest<LlmSettings>("/api/settings/llm", { method: "PUT", body: JSON.stringify(payload) }),
  test: () => apiRequest<{ ok: boolean; message: string }>("/api/settings/llm/test", { method: "POST" })
};
