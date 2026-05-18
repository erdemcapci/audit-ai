import { apiRequest } from "./client";
import type { InterviewPlan } from "../types";

export const interviewsApi = {
  get: (projectId: string) => apiRequest<InterviewPlan>(`/api/projects/${projectId}/interviews`),
  update: (projectId: string, plan: InterviewPlan) =>
    apiRequest<InterviewPlan>(`/api/projects/${projectId}/interviews`, { method: "PUT", body: JSON.stringify(plan) }),
  generatePlan: (projectId: string) =>
    apiRequest<InterviewPlan>(`/api/projects/${projectId}/interviews/generate-plan`, { method: "POST" })
};
