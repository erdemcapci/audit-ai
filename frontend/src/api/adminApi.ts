import { apiRequest } from "./client";
import type { RuntimeSettings } from "./settingsApi";

export type AdminMe = {
  isAdmin: boolean;
  runtime: RuntimeSettings;
};

export type DemoJobStep = {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
};

export type DemoJobStatus = {
  jobId: string;
  status: "running" | "completed" | "partial" | "failed";
  projectId?: string | null;
  currentStep: string;
  steps: DemoJobStep[];
  error?: string | null;
};

export type DemoCreatePayload = {
  title: string;
  description: string;
  processArea?: string;
  initialConcern?: string;
  runFullDemo: boolean;
};

export const adminApi = {
  login: (secret: string) => apiRequest<AdminMe>("/api/admin/login", { method: "POST", body: JSON.stringify({ secret }) }),
  me: () => apiRequest<AdminMe>("/api/admin/me"),
  logout: () => apiRequest<AdminMe>("/api/admin/logout", { method: "POST" }),
  createDemo: (payload: DemoCreatePayload) =>
    apiRequest<DemoJobStatus>("/api/admin/demo/create-full", { method: "POST", body: JSON.stringify(payload) }),
  getJob: (jobId: string) => apiRequest<DemoJobStatus>(`/api/admin/demo/jobs/${jobId}`)
};
