import { apiRequest } from "./client";
import type { ReportState } from "../types";

export const reportsApi = {
  get: (projectId: string) => apiRequest<ReportState>(`/api/projects/${projectId}/reports`),
  update: (projectId: string, report: ReportState) =>
    apiRequest<ReportState>(`/api/projects/${projectId}/reports`, { method: "PUT", body: JSON.stringify(report) }),
  generateExecutiveSummary: (projectId: string) =>
    apiRequest<ReportState>(`/api/projects/${projectId}/reports/generate-executive-summary`, { method: "POST" }),
  generateDraftReport: (projectId: string) =>
    apiRequest<ReportState>(`/api/projects/${projectId}/reports/generate-draft-report`, { method: "POST" }),
  exportMarkdown: (projectId: string) => apiRequest<string>(`/api/projects/${projectId}/reports/export-markdown`)
};
