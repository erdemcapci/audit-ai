import { apiRequest, apiRequestBinary } from "../../api/client";
import type { RunRecord, RunRecordContent, RunSummary } from "./engine/session";

const base = (projectId: string) => `/api/projects/${projectId}/data-quality`;

export type StoredSourceFile = { content_hash: string; compressed_size: number; size: number };

export const dataQualityApi = {
  listRuns: (projectId: string) => apiRequest<RunSummary[]>(`${base(projectId)}/runs`),
  getRun: (projectId: string, runId: string) => apiRequest<RunRecord>(`${base(projectId)}/runs/${runId}`),
  createRun: (projectId: string, content: RunRecordContent) =>
    apiRequest<RunRecord>(`${base(projectId)}/runs`, { method: "POST", body: JSON.stringify(content) }),
  deleteRun: (projectId: string, runId: string) => apiRequest<{ message: string }>(`${base(projectId)}/runs/${runId}`, { method: "DELETE" }),
  /** Body is the gzip-compressed file; the server returns the SHA-256 of the uncompressed content. */
  uploadFile: (projectId: string, compressed: Blob) =>
    apiRequest<StoredSourceFile>(`${base(projectId)}/files`, { method: "POST", body: compressed, headers: { "Content-Type": "application/gzip" } }),
  downloadFile: (projectId: string, contentHash: string) => apiRequestBinary(`${base(projectId)}/files/${contentHash}`),
  deleteFile: (projectId: string, contentHash: string) => apiRequest<{ message: string }>(`${base(projectId)}/files/${contentHash}`, { method: "DELETE" })
};
