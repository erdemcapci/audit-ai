import type { AuditMapResponse, PlanningState } from "../../types";
import type { ReadinessIssue } from "./summary";

export type ArtifactPresentation = { label: string; type: string; area: string };
export type ArtifactPresentations = Record<string, ArtifactPresentation>;
const internalId = /(?:audit|ws|obj|risk|test|agent|fw|finding|node|artifact)_[0-9a-fA-F]{10,32}/g;
export function displayLabel(label: string, id = "") {
  return label && label !== id ? label.replace(internalId, "referenced plan item") : "Untitled plan item";
}
export function conciseText(text: string, limit = 220) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0].trim();
  if (firstSentence && firstSentence.length <= limit) return firstSentence;
  const excerpt = normalized.slice(0, limit - 1);
  return `${excerpt.slice(0, excerpt.lastIndexOf(" ") > limit / 2 ? excerpt.lastIndexOf(" ") : undefined)}…`;
}
const groupLabels: Record<string, string> = {
  auditNode: "Audits", phaseNode: "Sections", workstreamNode: "Workstreams", objectiveNode: "Objectives",
  riskNode: "Risks", testNode: "Tests", agentNode: "Agents"
};
export const artifactGroup = (type: string) => groupLabels[type] || "Other plan items";

export function buildArtifactPresentations(map: AuditMapResponse | null, planning: PlanningState | null): ArtifactPresentations {
  if (!map) return {};
  const areaById = new Map<string, string>();
  for (const workstream of planning?.workstreams || []) {
    const area = displayLabel(workstream.name || workstream.description, workstream.id);
    areaById.set(workstream.id, area);
    for (const objective of workstream.objectives) {
      areaById.set(objective.id, area);
      for (const risk of objective.risks) {
        areaById.set(risk.id, area);
        for (const test of risk.tests) areaById.set(test.id, area);
      }
    }
  }
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const parentType: Record<string, string> = { testNode: "riskNode", riskNode: "objectiveNode", objectiveNode: "workstreamNode" };
  function areaFor(id: string, visited = new Set<string>()): string {
    if (areaById.has(id)) return areaById.get(id)!;
    if (visited.has(id)) return "";
    visited.add(id);
    const node = byId.get(id);
    if (node?.type === "workstreamNode") return displayLabel(String(node.data.title || node.data.description || ""), id);
    // Only supported parent relationships supply area context. Never expand
    // the affected set to neighbors, agents or other connected cards.
    const parent = map!.edges.find((edge) => edge.target === id && parentType[node?.type || ""] && byId.get(edge.source)?.type === parentType[node?.type || ""]);
    return parent ? areaFor(parent.source, visited) : "";
  }
  return Object.fromEntries(map.nodes.map((node) => [node.id, {
    label: displayLabel(String(node.data.title || node.data.description || ""), node.id), type: node.type, area: areaFor(node.id)
  }]));
}

export function findingArtifacts(issue: ReadinessIssue, artifacts: ArtifactPresentations) {
  const ids = [...new Set(issue.artifactIds)].filter((id) => Object.prototype.hasOwnProperty.call(artifacts, id));
  const items = ids.map((id) => ({ id, ...artifacts[id] }));
  let areas = [...new Set(items.map((item) => item.area).filter(Boolean))];
  if (!areas.length && issue.branch) {
    const knownAreas = new Set(Object.values(artifacts).map((item) => item.area).filter(Boolean));
    areas = [...new Set(issue.branch.split(" / ").filter((name) => knownAreas.has(name)))];
  }
  return { ids, items, areas };
}
