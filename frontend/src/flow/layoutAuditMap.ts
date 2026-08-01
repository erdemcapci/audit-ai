import type { AuditMapResponse, PhaseLayout } from "../types";

type Position = { x: number; y: number };

const NODE_WIDTH = 560;
const NODE_HEIGHT = 130;
const VERTICAL_GAP = 180;

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

export function avoidNodeOverlap(position: Position, existingNodes: AuditMapResponse["nodes"]): Position {
  const next = { ...position };
  let guard = 0;
  while (
    existingNodes.some((node) => Math.abs(node.position.x - next.x) < NODE_WIDTH && Math.abs(node.position.y - next.y) < NODE_HEIGHT) &&
    guard < 100
  ) {
    next.y += VERTICAL_GAP;
    guard += 1;
  }
  return next;
}

export function getNextAvailablePosition(
  phase: PhaseLayout,
  nodeType: string,
  existingNodes: AuditMapResponse["nodes"],
  relatedNodeId?: string
): Position {
  const relatedNode = relatedNodeId ? existingNodes.find((node) => node.id === relatedNodeId) : null;
  const xOffsets: Record<string, number> = {
    workstreamNode: 80,
    objectiveNode: 360,
    riskNode: 680,
    testNode: 1000,
    fieldworkItemNode: 100,
    findingNode: 450,
    reportNode: 120
  };
  const base = {
    x: phase.x + (xOffsets[nodeType] || 120),
    y: relatedNode ? relatedNode.position.y + VERTICAL_GAP : phase.y + 140
  };
  return avoidNodeOverlap(base, existingNodes);
}

export function expandPhaseToFitNodes(phase: PhaseLayout, nodes: AuditMapResponse["nodes"]): PhaseLayout {
  if (!nodes.length) return phase;
  const maxX = Math.max(...nodes.map((node) => node.position.x + NODE_WIDTH));
  const maxY = Math.max(...nodes.map((node) => node.position.y + NODE_HEIGHT));
  return {
    ...phase,
    width: Math.max(phase.width, maxX - phase.x + 120),
    height: Math.max(phase.height, maxY - phase.y + 120)
  };
}

export function layoutGeneratedNodesNearAgent(
  agentNode: AuditMapResponse["nodes"][number],
  generatedNodes: AuditMapResponse["nodes"],
  existingNodes: AuditMapResponse["nodes"]
): AuditMapResponse["nodes"] {
  return generatedNodes.map((node, index) => ({
    ...node,
    position: avoidNodeOverlap({ x: agentNode.position.x + 360, y: agentNode.position.y + index * VERTICAL_GAP }, existingNodes)
  }));
}

export function layoutAuditMap(map: AuditMapResponse): AuditMapResponse {
  return map;
}
