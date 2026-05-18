import type { AuditMapResponse, AuditProject, FieldworkState, FindingsState, InterviewPlan, PlanningState, ReportState } from "../types";

export type AuditEntity = {
  id: string;
  type: string;
  title: string;
  nodeType?: string;
};

export type AuditRelationship = {
  sourceId: string;
  targetId: string;
  type: string;
  traversable?: boolean;
};

export type AuditGraph = {
  entitiesById: Record<string, AuditEntity>;
  relationships: AuditRelationship[];
};

export type AuditGraphProjectState = {
  project: AuditProject | null;
  planning: PlanningState | null;
  interviews: InterviewPlan | null;
  fieldwork: FieldworkState | null;
  findings: FindingsState | null;
  report: ReportState | null;
  map: AuditMapResponse | null;
};

const CONTAINER_NODE_TYPES = new Set(["phaseNode", "fieldworkSectionNode"]);
const AGENT_NODE_TYPE = "agentNode";
const CONTEXT_RELATIONSHIPS = new Set(["contains", "tests", "executed_as", "clarified_by", "requires_document", "results_in", "reported_in", "flow"]);

function titleFromNode(node: AuditMapResponse["nodes"][number]): string {
  return String(node.data?.title || node.id);
}

function addEntity(entitiesById: Record<string, AuditEntity>, entity: AuditEntity) {
  if (!entity.id) return;
  entitiesById[entity.id] = { ...entity, ...entitiesById[entity.id], ...entity };
}

function addRelationship(relationships: AuditRelationship[], sourceId: string | null | undefined, targetId: string | null | undefined, type: string, traversable = true) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const exists = relationships.some((relationship) => relationship.sourceId === sourceId && relationship.targetId === targetId && relationship.type === type);
  if (!exists) relationships.push({ sourceId, targetId, type, traversable });
}

export function buildAuditGraph(state: AuditGraphProjectState): AuditGraph {
  const entitiesById: Record<string, AuditEntity> = {};
  const relationships: AuditRelationship[] = [];
  const nodeTypeById = new Map<string, string>();

  state.map?.nodes.forEach((node) => {
    nodeTypeById.set(node.id, node.type);
    if (CONTAINER_NODE_TYPES.has(node.type)) return;
    addEntity(entitiesById, { id: node.id, type: node.type, nodeType: node.type, title: titleFromNode(node) });
  });

  if (state.project) {
    addEntity(entitiesById, { id: state.project.id, type: "audit", nodeType: "auditNode", title: state.project.title });
  }

  state.planning?.workstreams.forEach((workstream) => {
    addEntity(entitiesById, { id: workstream.id, type: "workstream", nodeType: "workstreamNode", title: workstream.name });
    addRelationship(relationships, state.project?.id, workstream.id, "contains");

    workstream.objectives.forEach((objective) => {
      addEntity(entitiesById, { id: objective.id, type: "objective", nodeType: "objectiveNode", title: objective.title });
      addRelationship(relationships, workstream.id, objective.id, "contains");

      objective.risks.forEach((risk) => {
        addEntity(entitiesById, { id: risk.id, type: "risk", nodeType: "riskNode", title: risk.title });
        addRelationship(relationships, objective.id, risk.id, "contains");

        risk.tests.forEach((test) => {
          addEntity(entitiesById, { id: test.id, type: "test", nodeType: "testNode", title: test.title });
          addRelationship(relationships, risk.id, test.id, "tests");
        });
      });
    });
  });

  state.interviews?.roles.forEach((role) => {
    addEntity(entitiesById, { id: role.id, type: "interviewRole", nodeType: "interviewRoleNode", title: role.role_title });
    role.questions.forEach((question) => {
      addEntity(entitiesById, { id: question.id, type: "interviewQuestion", nodeType: "interviewQuestionNode", title: question.question_text });
      addRelationship(relationships, role.id, question.id, "contains");
      addRelationship(relationships, question.id, role.id, "asked_by");
      addRelationship(relationships, question.mapped_objective_id, question.id, "clarified_by");
      addRelationship(relationships, question.mapped_risk_id, question.id, "clarified_by");
      addRelationship(relationships, question.mapped_test_id, question.id, "clarified_by");
    });
  });

  const sourceTestByFieldworkId = new Map<string, string>();
  state.fieldwork?.items.forEach((item) => {
    const sourceTestId = item.source_test_id || item.test_id;
    sourceTestByFieldworkId.set(item.id, sourceTestId);
    addEntity(entitiesById, { id: item.id, type: "fieldworkItem", nodeType: "fieldworkItemNode", title: item.title });
    addRelationship(relationships, sourceTestId, item.id, "executed_as");
    item.finding_ids.forEach((findingId) => addRelationship(relationships, item.id, findingId, "results_in"));
  });

  state.findings?.findings.forEach((finding) => {
    addEntity(entitiesById, { id: finding.id, type: "finding", nodeType: "findingNode", title: finding.title });
    addRelationship(relationships, finding.linked_fieldwork_item_id, finding.id, "results_in");
    const sourceTestId = finding.linked_fieldwork_item_id ? sourceTestByFieldworkId.get(finding.linked_fieldwork_item_id) : null;
    addRelationship(relationships, sourceTestId, finding.id, "results_in");
  });

  state.map?.nodes.forEach((node) => {
    if (node.type === "fieldworkItemNode") {
      addRelationship(relationships, node.data.source_test_id, node.id, "executed_as");
    }
    if (node.type === "documentRequestNode") {
      addRelationship(relationships, node.data.source_node_id, node.id, "requires_document");
    }
  });

  state.map?.edges.forEach((edge) => {
    const sourceType = nodeTypeById.get(edge.source);
    const targetType = nodeTypeById.get(edge.target);
    if (!sourceType || !targetType || CONTAINER_NODE_TYPES.has(sourceType) || CONTAINER_NODE_TYPES.has(targetType)) return;
    if (sourceType === AGENT_NODE_TYPE || targetType === AGENT_NODE_TYPE) {
      addRelationship(relationships, edge.source, edge.target, "agent_related", false);
      return;
    }
    addRelationship(relationships, edge.source, edge.target, "flow");
  });

  const reportNodeIds = state.map?.nodes.filter((node) => node.type === "reportNode").map((node) => node.id) || [];
  state.findings?.findings.forEach((finding) => {
    reportNodeIds.forEach((reportNodeId) => addRelationship(relationships, finding.id, reportNodeId, "reported_in"));
  });

  return { entitiesById, relationships };
}

export function collectRelatedEntityIds(graph: AuditGraph, seedIds: string[]): Set<string> {
  const visible = new Set<string>();
  const forward = new Map<string, AuditRelationship[]>();
  const reverse = new Map<string, AuditRelationship[]>();
  const agentLinks: AuditRelationship[] = [];

  graph.relationships.forEach((relationship) => {
    forward.set(relationship.sourceId, [...(forward.get(relationship.sourceId) || []), relationship]);
    reverse.set(relationship.targetId, [...(reverse.get(relationship.targetId) || []), relationship]);
    if (relationship.type === "agent_related") agentLinks.push(relationship);
  });

  const addAncestors = (id: string) => {
    (reverse.get(id) || []).forEach((relationship) => {
      if (relationship.traversable === false || !CONTEXT_RELATIONSHIPS.has(relationship.type) || visible.has(relationship.sourceId)) return;
      visible.add(relationship.sourceId);
      addAncestors(relationship.sourceId);
    });
  };

  const addDownstream = (id: string) => {
    (forward.get(id) || []).forEach((relationship) => {
      if (relationship.traversable === false) return;
      if (visible.has(relationship.targetId)) return;
      visible.add(relationship.targetId);
      addDownstream(relationship.targetId);
    });
  };

  seedIds.filter(Boolean).forEach((seedId) => {
    visible.add(seedId);
    addAncestors(seedId);
    addDownstream(seedId);
  });

  agentLinks.forEach((relationship) => {
    if (visible.has(relationship.sourceId)) visible.add(relationship.targetId);
    if (visible.has(relationship.targetId)) visible.add(relationship.sourceId);
  });

  return visible;
}
