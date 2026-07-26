import type { RuntimeSettings } from "../api/settingsApi";
import type { AuditProject } from "../types";

export type WorkspaceRuntimePolicy = {
  agentExecutionMessage: string;
  showAiProviderInfo: boolean;
  aiProviderLabel?: string;
  aiModelLabel?: string;
  showSignIn: boolean;
  projectAccessMessage?: string;
};

export function workspaceRuntimePolicy(
  runtime: RuntimeSettings | null,
  project: AuditProject | null,
  isAuthenticated: boolean
): WorkspaceRuntimePolicy {
  const isHosted = runtime?.deploymentMode === "hosted";
  let projectAccessMessage: string | undefined;

  if (isHosted && project?.visibility === "anonymous_temp") {
    projectAccessMessage = "Temporary demo audit — changes are only available in this browser/session. Sign in to save your audit.";
  } else if (isHosted && project?.visibility === "public_sample") {
    projectAccessMessage = "Public sample audit - this demo data is read-only for visitors.";
  }

  return {
    agentExecutionMessage:
      runtime?.aiAccessMessage ||
      (isHosted ? "AI generation requires approved access." : "No AI provider is configured."),
    showAiProviderInfo: !isHosted,
    aiProviderLabel: isHosted ? runtime?.activeAiProviderLabel : undefined,
    aiModelLabel: isHosted ? runtime?.activeAiModelLabel : undefined,
    showSignIn: Boolean(isHosted && !isAuthenticated),
    projectAccessMessage
  };
}
