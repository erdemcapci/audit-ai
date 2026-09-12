import type { AuditMapResponse } from "../types";

export function calculateRequiredNodeSize(
  nodeData: { title?: string; description?: string; agentType?: string },
  currentWidth = 560
): { width: number; height: number } {
  const minWidth = nodeData.agentType ? 560 : 560;
  const minHeight = nodeData.agentType ? 160 : 140;
  const width = Math.max(currentWidth, minWidth);
  const charsPerLine = Math.max(Math.floor((width - 36) / 8.8), 20);
  const titleLength = nodeData.title?.length || 0;
  const descriptionLength = nodeData.description?.length || 0;
  const titleLines = Math.max(1, Math.ceil(titleLength / charsPerLine));
  const descriptionLines = descriptionLength ? Math.ceil(descriptionLength / charsPerLine) : 0;
  let metaRows = 1;
  if (nodeData.agentType) metaRows += 1;
  const height = 38 + titleLines * 30 + descriptionLines * 26 + metaRows * 30 + 24;
  return { width, height: Math.max(height, minHeight) };
}

export function layoutAuditMap(map: AuditMapResponse): AuditMapResponse {
  return map;
}
