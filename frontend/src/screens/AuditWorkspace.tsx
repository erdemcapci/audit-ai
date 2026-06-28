import { useCallback, useEffect, useState } from "react";
import type { Node } from "@xyflow/react";

import { agentsApi } from "../api/agentsApi";
import { fieldworkApi } from "../api/fieldworkApi";
import { findingsApi } from "../api/findingsApi";
import { interviewsApi } from "../api/interviewsApi";
import { planningApi } from "../api/planningApi";
import { projectsApi } from "../api/projectsApi";
import { reportsApi } from "../api/reportsApi";
import type { RuntimeSettings } from "../api/settingsApi";
import { BrandingFooter, LinkedInLogoLink } from "../components/BrandingFooter";
import { Button } from "../components/Button";
import { LoadingState } from "../components/LoadingState";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { TextArea } from "../components/TextArea";
import { AuditMapCanvas, type MapHierarchyFilters } from "../flow/AuditMapCanvas";
import { calculateRequiredNodeSize } from "../flow/layoutAuditMap";
import { AiAssistantPanel } from "../panels/AiAssistantPanel";
import { AutoLayoutPanel } from "../panels/AutoLayoutPanel";
import { DetailPanel } from "../panels/DetailPanel";
import type {
  AgentDefinition,
  AgentOutputConflict,
  AgentRunMode,
  AuditMapResponse,
  AuditProject,
  AutoLayoutConfig,
  FieldworkState,
  FindingsState,
  FlowNodeData,
  InterviewPlan,
  MapStateUpdate,
  PlanningState,
  ReportState
} from "../types";
import { FieldworkScreen } from "./FieldworkScreen";
import { InterviewsScreen } from "./InterviewsScreen";
import { PlanningScreen } from "./PlanningScreen";
import { ReportingScreen } from "./ReportingScreen";
import { SettingsScreen } from "./SettingsScreen";
import { AgentRunLogsScreen } from "./AgentRunLogsScreen";
import { deriveAuditChecklistState } from "../utils/auditChecklist";

type PhaseFilter = "all" | "planning" | "fieldwork" | "reporting" | "execution";
type FieldworkCreateMode = "keep" | "missing" | "replace";

type PendingAgentRun = {
  agentId: string;
  inputNodeIds: string[];
  conflicts: AgentOutputConflict[];
  roughFindingText?: string;
  temporaryContent?: string;
};

type PendingFindingAgentRun = {
  agentId: string;
  inputNodeIds: string[];
  selectedInputNodeId: string;
};

function renderMarkdownPreview(markdown: string) {
  const lines = markdown.split("\n");
  return lines.map((line, index) => {
    if (line.startsWith("### ")) return <h4 key={index}>{line.replace(/^### /, "")}</h4>;
    if (line.startsWith("## ")) return <h3 key={index}>{line.replace(/^## /, "")}</h3>;
    if (line.startsWith("# ")) return <h2 key={index}>{line.replace(/^# /, "")}</h2>;
    if (line.startsWith("- ")) return <li key={index}>{line.replace(/^- /, "")}</li>;
    if (!line.trim()) return <div key={index} className="markdown-gap" />;
    return <p key={index}>{line}</p>;
  });
}

function agentPhase(agentType: string): PhaseFilter {
  if (agentType === "finding_draft_agent" || agentType === "interview_plan_generator" || agentType === "document_request_generator") return "fieldwork";
  if (agentType === "report_draft_agent") return "reporting";
  return "planning";
}

export function AuditWorkspace({
  projectId,
  onReset,
  runtime,
  onRuntimeChanged
}: {
  projectId: string;
  onReset: () => void;
  runtime: RuntimeSettings | null;
  onRuntimeChanged?: () => Promise<unknown>;
}) {
  const [project, setProject] = useState<AuditProject | null>(null);
  const [planning, setPlanning] = useState<PlanningState | null>(null);
  const [interviews, setInterviews] = useState<InterviewPlan | null>(null);
  const [fieldwork, setFieldwork] = useState<FieldworkState | null>(null);
  const [findings, setFindings] = useState<FindingsState | null>(null);
  const [report, setReport] = useState<ReportState | null>(null);
  const [map, setMap] = useState<AuditMapResponse | null>(null);
  const [agentTypes, setAgentTypes] = useState<AgentDefinition[]>([]);
  const [agentTypeToAdd, setAgentTypeToAdd] = useState("test_generator");
  const [selectedNode, setSelectedNode] = useState<Node<FlowNodeData> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeScreen, setActiveScreen] = useState("Map");
  const [showAutoLayoutConfig, setShowAutoLayoutConfig] = useState(false);
  const [pendingAgentRun, setPendingAgentRun] = useState<PendingAgentRun | null>(null);
  const [pendingFindingAgentRun, setPendingFindingAgentRun] = useState<PendingFindingAgentRun | null>(null);
  const [findingAgentText, setFindingAgentText] = useState("");
  const [temporaryAgentContentById, setTemporaryAgentContentById] = useState<Record<string, string>>({});
  const [reportAttachmentNodeId, setReportAttachmentNodeId] = useState<string | null>(null);
  const [reportAttachmentDraft, setReportAttachmentDraft] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [mapFilters, setMapFilters] = useState<Pick<MapHierarchyFilters, "showInterviews" | "showDocumentRequests">>({
    showInterviews: true,
    showDocumentRequests: true
  });
  const [showApprovePlanning, setShowApprovePlanning] = useState(false);
  const [fieldworkCreateMode, setFieldworkCreateMode] = useState<FieldworkCreateMode>("missing");

  const refresh = useCallback(async () => {
    const [projectData, planningData, interviewData, fieldworkData, findingsData, reportData, mapData, agentTypeData] = await Promise.all([
      projectsApi.get(projectId),
      planningApi.get(projectId),
      interviewsApi.get(projectId),
      fieldworkApi.get(projectId),
      findingsApi.get(projectId),
      reportsApi.get(projectId),
      projectsApi.map(projectId),
      agentsApi.types()
    ]);
    setProject(projectData);
    setPlanning(planningData);
    setInterviews(interviewData);
    setFieldwork(fieldworkData);
    setFindings(findingsData);
    setReport(reportData);
    setMap({ nodes: Array.isArray(mapData?.nodes) ? mapData.nodes : [], edges: Array.isArray(mapData?.edges) ? mapData.edges : [] });
    setAgentTypes(Array.isArray(agentTypeData) ? agentTypeData : []);
  }, [projectId]);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Unable to load audit."));
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMapState(state: MapStateUpdate) {
    await projectsApi.updateMap(projectId, state);
  }

  function agentPosition(type: string): { x: number; y: number } {
    const targetPhase = agentPhase(type);
    const targetSection =
      type === "interview_plan_generator"
        ? map?.nodes.find((node) => node.id === "fieldwork-section-interviews")
        : type === "document_request_generator"
          ? map?.nodes.find((node) => node.id === "fieldwork-section-documents")
          : type === "finding_draft_agent"
            ? map?.nodes.find((node) => node.id === "fieldwork-section-issues")
            : null;
    if (targetSection) {
      const existingSectionAgents = map?.nodes.filter(
        (node) =>
          node.type === "agentNode" &&
          node.position.x >= targetSection.position.x &&
          node.position.x < targetSection.position.x + Number(targetSection.data.width || targetSection.width || 420)
      ).length || 0;
      return { x: targetSection.position.x + 40, y: targetSection.position.y - 210 - existingSectionAgents * 190 };
    }
    const phaseNode = map?.nodes.find((node) => node.id === `phase-${targetPhase}`);
    const x = (phaseNode?.position.x || 0) + (targetPhase === "reporting" ? 120 : targetPhase === "fieldwork" ? 120 : 360);
    const baseY = (phaseNode?.position.y || 0) - 220;
    const existingAgentsInPhase = map?.nodes.filter((node) => {
      if (node.type !== "agentNode") return false;
      if (targetPhase === "planning") return node.position.x < (map.nodes.find((item) => item.id === "phase-fieldwork")?.position.x || 1500);
      if (targetPhase === "fieldwork") {
        const fieldworkX = map.nodes.find((item) => item.id === "phase-fieldwork")?.position.x || 1500;
        const reportingX = map.nodes.find((item) => item.id === "phase-reporting")?.position.x || 2550;
        return node.position.x >= fieldworkX && node.position.x < reportingX;
      }
      return node.position.x >= (map.nodes.find((item) => item.id === "phase-reporting")?.position.x || 2550);
    }).length || 0;
    return { x, y: baseY - existingAgentsInPhase * 190 };
  }

  async function addAgent() {
    const targetPhase = agentPhase(agentTypeToAdd);
    await run(() => agentsApi.create(projectId, agentTypeToAdd, agentPosition(agentTypeToAdd)));
    if (phaseFilter !== "all" && phaseFilter !== targetPhase && !(phaseFilter === "execution" && (targetPhase === "fieldwork" || targetPhase === "reporting"))) {
      setPhaseFilter(targetPhase);
    }
  }

  async function runAgent(agentId: string, localInputNodeIds?: string[]) {
    if (runtime && !runtime.agentExecutionEnabled) {
      setError(runtime.deploymentMode === "hosted" ? "AI agent execution is disabled in this hosted showcase." : "No AI provider is configured for agent execution.");
      return;
    }
    const inputNodeIds = localInputNodeIds || map?.edges.filter((edge) => edge.target === agentId).map((edge) => edge.source) || [];
    const agentNode = map?.nodes.find((node) => node.id === agentId);
    const temporaryContent = temporaryAgentContentById[agentId] || "";
    if (agentNode?.data.agentType === "report_draft_agent") {
      await prepareAgentRun(agentId, [], "", temporaryContent);
      return;
    }
    if (inputNodeIds.length === 0) {
      setError("This agent has no inputs yet. Connect it to related cards first.");
      return;
    }
    if (agentNode?.data.agentType === "finding_draft_agent") {
      setFindingAgentText("");
      const fieldworkInputNodeIds = inputNodeIds.filter((nodeId) => map?.nodes.find((node) => node.id === nodeId)?.type === "fieldworkItemNode");
      const findingInputNodeIds = fieldworkInputNodeIds.length ? fieldworkInputNodeIds : inputNodeIds;
      setPendingFindingAgentRun({ agentId, inputNodeIds: findingInputNodeIds, selectedInputNodeId: findingInputNodeIds[0] || "" });
      return;
    }
    await prepareAgentRun(agentId, inputNodeIds, "", temporaryContent);
  }

  async function prepareAgentRun(agentId: string, inputNodeIds: string[], roughFindingText = "", temporaryContent = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const check = await agentsApi.checkOutputs(projectId, agentId, { input_node_ids: inputNodeIds });
      if (check.conflicts.length) {
        setPendingFindingAgentRun(null);
        setPendingAgentRun({ agentId, inputNodeIds, conflicts: check.conflicts, roughFindingText, temporaryContent });
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to check existing outputs.");
      return;
    } finally {
      setBusy(false);
    }
    await executeAgentRun(agentId, inputNodeIds, "append", roughFindingText, temporaryContent);
  }

  async function executeAgentRun(agentId: string, inputNodeIds: string[], runMode: AgentRunMode, roughFindingText = "", temporaryContent = "") {
    setPendingAgentRun(null);
    setPendingFindingAgentRun(null);
    await run(() =>
      agentsApi.run(projectId, agentId, {
        input_node_ids: inputNodeIds,
        run_mode: runMode,
        rough_finding_text: roughFindingText,
        temporary_content: temporaryContent
      })
    );
  }

  async function submitFindingAgentRun() {
    if (!pendingFindingAgentRun) return;
    if (!findingAgentText.trim()) {
      setError("Add a rough issue description before running the Finding Draft Agent.");
      return;
    }
    if (!pendingFindingAgentRun.selectedInputNodeId) {
      setError("Choose the fieldwork test card this finding relates to.");
      return;
    }
    await prepareAgentRun(
      pendingFindingAgentRun.agentId,
      [pendingFindingAgentRun.selectedInputNodeId],
      findingAgentText,
      temporaryAgentContentById[pendingFindingAgentRun.agentId] || ""
    );
  }

  async function saveNode(nodeId: string, nodeType: string, fields: Record<string, unknown>) {
    await run(() => projectsApi.updateNode(projectId, nodeId, nodeType, fields));
  }

  async function saveAgent(agentId: string, fields: { title?: string; prompt?: string; config?: Record<string, unknown> }) {
    await run(() => agentsApi.update(projectId, agentId, fields));
  }

  function openReportAttachment(nodeId: string) {
    const reportNode = map?.nodes.find((node) => node.id === nodeId);
    const isExecutiveSummary = nodeId === "executive-summary";
    setReportAttachmentNodeId(nodeId);
    setReportAttachmentDraft(
      isExecutiveSummary
        ? reportNode?.data.executive_summary || report?.executive_summary || ""
        : reportNode?.data.draft_markdown || report?.draft_markdown || reportNode?.data.executive_summary || report?.executive_summary || ""
    );
  }

  async function saveReportAttachment() {
    if (!reportAttachmentNodeId) return;
    const fields =
      reportAttachmentNodeId === "executive-summary"
        ? { executive_summary: reportAttachmentDraft }
        : { draft_markdown: reportAttachmentDraft };
    await saveNode(reportAttachmentNodeId, "reportNode", fields);
    setReportAttachmentNodeId(null);
  }

  async function deleteNode(nodeId: string) {
    await run(async () => {
      const node = map?.nodes.find((item) => item.id === nodeId);
      if (node?.type === "agentNode") {
        await agentsApi.delete(projectId, nodeId);
        setSelectedNode(null);
        return;
      }
      const nextMap = await projectsApi.deleteNode(projectId, nodeId);
      setMap(nextMap);
      setSelectedNode(null);
    });
  }

  async function deleteOutputs(nodeId: string) {
    await run(async () => {
      const nextMap = await projectsApi.deleteOutputs(projectId, nodeId);
      setMap(nextMap);
      setNotice("Deleted outputs for the selected card.");
    });
  }

  async function deleteDimension(phase: "planning" | "fieldwork" | "reporting", dimension: string) {
    await run(async () => {
      const nextMap = await projectsApi.bulkDelete(projectId, { phase, dimension });
      setMap(nextMap);
      setNotice("Deleted cards in the selected dimension.");
    });
  }

  function previewNode(nodeId: string, fields: Record<string, string>) {
    setMap((current) => {
      if (!current) return current;
      return {
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          const nextData = {
            ...node.data,
            title: fields.title ?? node.data.title,
            description: fields.description ?? fields.issue ?? fields.executive_summary ?? fields.question_text ?? node.data.description,
            severity: fields.severity ?? node.data.severity,
            testType: fields.test_type ?? node.data.testType,
            itemStatus: fields.status ?? node.data.itemStatus,
            rationale: fields.rationale ?? node.data.rationale,
            scope_notes: fields.scope_notes ?? node.data.scope_notes,
            why_it_matters: fields.why_it_matters ?? node.data.why_it_matters,
            potential_impact: fields.potential_impact ?? node.data.potential_impact,
            test_objective: fields.test_objective ?? node.data.test_objective,
            expected_evidence: fields.expected_evidence ?? node.data.expected_evidence,
            sample_considerations: fields.sample_considerations ?? node.data.sample_considerations,
            issue: fields.issue ?? node.data.issue,
            criteria: fields.criteria ?? node.data.criteria,
            root_cause: fields.root_cause ?? node.data.root_cause,
            impact: fields.impact ?? node.data.impact,
            recommendation: fields.recommendation ?? node.data.recommendation
          };
          if (node.type === "agentNode") {
            nextData.title = fields.title ?? node.data.title;
            nextData.description = fields.prompt ?? node.data.description;
          }
          const required = calculateRequiredNodeSize(nextData, node.width || node.data.width || 560);
          return {
            ...node,
            width: Math.max(node.width || node.data.width || 560, required.width),
            height: Math.max(node.height || node.data.height || 140, required.height),
            data: {
              ...nextData,
              width: Math.max(node.width || node.data.width || 560, required.width),
              height: Math.max(node.height || node.data.height || 140, required.height)
            }
          };
        })
      };
    });
  }

  async function connectRelated(agentId: string) {
    if (!map) return;
    const agentNode = map.nodes.find((node) => node.id === agentId);
    const definition = agentTypes.find((agentType) => agentType.type === agentNode?.data.agentType);
    if (!agentNode || !definition) return;

    let candidates = map.nodes.filter((node) => definition.allowed_input_node_types.includes(node.type));
    if (agentNode.data.agentType === "interview_plan_generator") {
      const fieldworkItems = candidates.filter((node) => node.type === "fieldworkItemNode");
      if (fieldworkItems.length) {
        candidates = fieldworkItems;
      }
    }
    if (agentNode.data.agentType === "finding_draft_agent") {
      candidates = candidates.filter((node) => node.type === "fieldworkItemNode");
    }
    if (agentNode.data.agentType === "document_request_generator") {
      const fieldworkItems = candidates.filter((node) => node.type === "fieldworkItemNode");
      if (fieldworkItems.length) {
        candidates = fieldworkItems;
      }
    }
    if (agentNode.data.agentType === "report_draft_agent") {
      candidates = candidates.filter((node) => node.type === "findingNode");
    }

    const existingIds = new Set(map.edges.map((edge) => edge.id));
    const newEdges = candidates
      .map((node) => ({
        id: `${node.id}->${agentId}`,
        source: node.id,
        target: agentId,
        type: "smoothstep",
        animated: true,
        data: {}
      }))
      .filter((edge) => !existingIds.has(edge.id));

    if (!newEdges.length) {
      setNotice(
        candidates.length
          ? "All related cards are already connected."
          : agentNode.data.agentType === "finding_draft_agent"
            ? "No fieldwork test cards found for this agent."
            : "No related cards found for this agent."
      );
      return;
    }

    const nextEdges = [...map.edges, ...newEdges];
    setMap({ ...map, edges: nextEdges });
    await projectsApi.updateMap(projectId, { edges: nextEdges });
    setNotice(`Connected to ${newEdges.length} related card${newEdges.length === 1 ? "" : "s"}.`);
    await refresh();
  }

  async function disconnectRelated(agentId: string) {
    if (!map) return;
    const agentNode = map.nodes.find((node) => node.id === agentId);
    const definition = agentTypes.find((agentType) => agentType.type === agentNode?.data.agentType);
    if (!agentNode || !definition) return;
    const allowedInputs = new Set(definition.allowed_input_node_types);
    const inputNodeTypes = new Map(map.nodes.map((node) => [node.id, node.type]));
    const nextEdges = map.edges.filter((edge) => !(edge.target === agentId && allowedInputs.has(inputNodeTypes.get(edge.source) || "")));
    const removedCount = map.edges.length - nextEdges.length;
    if (!removedCount) {
      setNotice("No related card connections found for this agent.");
      return;
    }
    setMap({ ...map, edges: nextEdges });
    await projectsApi.updateMap(projectId, { edges: nextEdges });
    setNotice(`Disconnected ${removedCount} related card connection${removedCount === 1 ? "" : "s"}.`);
    await refresh();
  }

  async function applyAutoLayout(config: AutoLayoutConfig) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const nextMap = await projectsApi.autoLayout(projectId, config);
      setMap(nextMap);
      setShowAutoLayoutConfig(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto layout failed.");
    } finally {
      setBusy(false);
    }
  }

  function countPlanningTests() {
    return (
      planning?.workstreams.reduce(
        (total, workstream) =>
          total +
          workstream.objectives.reduce(
            (objectiveTotal, objective) =>
              objectiveTotal + objective.risks.reduce((riskTotal, risk) => riskTotal + risk.tests.length, 0),
            0
          ),
        0
      ) || 0
    );
  }

  async function approvePlanning(createFieldwork: boolean, mode: FieldworkCreateMode = "missing") {
    const beforeSources = new Set((fieldwork?.items || []).map((item) => item.source_test_id || item.test_id));
    const totalTests = countPlanningTests();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await planningApi.approve(projectId);
      let createdCount = 0;
      if (createFieldwork) {
        const nextFieldwork = await fieldworkApi.createFromPlanning(projectId, mode);
        if (mode === "replace") {
          createdCount = totalTests;
        } else if (mode === "missing") {
          createdCount = nextFieldwork.items.filter((item) => !beforeSources.has(item.source_test_id || item.test_id)).length;
        }
        setPhaseFilter("fieldwork");
        setActiveScreen("Map");
        const message = `Planning approved. Created ${createdCount} fieldwork item${createdCount === 1 ? "" : "s"}.`;
        setNotice(message);
      } else {
        setNotice("Planning approved.");
      }
      setShowApprovePlanning(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve planning.");
    } finally {
      setBusy(false);
    }
  }

  const checklist = deriveAuditChecklistState({ project, planning, interviews, fieldwork, findings, report });
  const hasFieldworkItems = Boolean(fieldwork?.items.length);

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <h1>{project?.title || "Audit"}</h1>
          <p>{project?.description}</p>
        </div>
        <div className="header-actions">
          <span className="header-contact">Questions or feedback <LinkedInLogoLink /></span>
          <Button variant={activeScreen === "Settings" ? "secondary" : "ghost"} onClick={() => setActiveScreen("Settings")}>Settings</Button>
          <Button variant="ghost" onClick={onReset}>New audit</Button>
          {busy ? <LoadingState label="Action running" /> : null}
        </div>
      </header>

      <div className="audit-progress-header">
        <div>
          <strong>{checklist.progressPercent}% complete</strong>
          <span>{checklist.completedCount} of {checklist.totalCount} checklist actions</span>
        </div>
        <div className="checklist-progress top-progress">
          <span style={{ width: `${checklist.progressPercent}%` }} />
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="message-text">{notice}</div> : null}
      {runtime?.deploymentMode === "hosted" && !runtime.agentExecutionEnabled ? (
        <div className="message-text">AI agent execution is disabled in this hosted showcase.</div>
      ) : null}

      <nav className="workspace-tabs">
        {["Map", "Planning", "Interviews", "Fieldwork", "Reporting"].map((tab) => (
          <button key={tab} className={activeScreen === tab ? "active" : ""} onClick={() => setActiveScreen(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      {activeScreen === "Map" ? (
        <>
        <div className="map-command-bar">
          <div className="map-command-row map-command-row-primary">
            <label>
              <span>Focus Phase</span>
              <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value as PhaseFilter)}>
                <option value="all">All phases</option>
                <option value="planning">Planning</option>
                <option value="fieldwork">Fieldwork</option>
                <option value="execution">Fieldwork + Reporting</option>
                <option value="reporting">Reporting</option>
              </select>
            </label>
            <label>
              <span>Add Agent</span>
              <select value={agentTypeToAdd} onChange={(event) => setAgentTypeToAdd(event.target.value)}>
                {agentTypes.map((agentType) => (
                  <option key={agentType.type} value={agentType.type}>{agentType.title}</option>
                ))}
              </select>
            </label>
            <Button variant="secondary" onClick={addAgent} disabled={busy || !agentTypes.length}>Add Agent Card</Button>
            <div className="map-section-toggles">
              <label className="map-toggle-label">
                <span>Show Interviews</span>
                <input
                  type="checkbox"
                  checked={mapFilters.showInterviews}
                  onChange={(event) => setMapFilters((current) => ({ ...current, showInterviews: event.target.checked }))}
                />
              </label>
              <label className="map-toggle-label">
                <span>Show Document Requests</span>
                <input
                  type="checkbox"
                  checked={mapFilters.showDocumentRequests}
                  onChange={(event) => setMapFilters((current) => ({ ...current, showDocumentRequests: event.target.checked }))}
                />
              </label>
            </div>
          </div>
        </div>
        <section className="workspace-grid">
          <AuditMapCanvas
            map={map}
            selectedNodeId={selectedNode?.id || null}
            agentTypes={agentTypes}
            onSelectNode={setSelectedNode}
            onSaveMap={saveMapState}
            onRunAgent={runAgent}
            onAutoLayout={async () => setShowAutoLayoutConfig(true)}
            onError={setError}
            phaseFilter={phaseFilter}
            agentExecutionEnabled={runtime?.agentExecutionEnabled ?? true}
            agentExecutionMessage={runtime?.deploymentMode === "hosted" ? "AI agent execution is disabled in this hosted showcase." : "No AI provider is configured."}
            actionBusy={busy}
            hierarchyFilters={{
              ...mapFilters,
              nodeIds: []
            }}
          />
          <div className="right-rail">
            {showAutoLayoutConfig ? (
              <AutoLayoutPanel onApply={applyAutoLayout} onCancel={() => setShowAutoLayoutConfig(false)} />
            ) : selectedNode ? (
              <DetailPanel
                node={selectedNode}
                agentTypes={agentTypes}
                onSaveNode={saveNode}
                onSaveAgent={saveAgent}
                onConnectRelated={connectRelated}
                onDisconnectRelated={disconnectRelated}
                onPreviewNode={previewNode}
                onDeleteNode={deleteNode}
                onDeleteOutputs={deleteOutputs}
                onDeleteDimension={deleteDimension}
                onOpenReport={openReportAttachment}
                temporaryRunContent={selectedNode.type === "agentNode" ? temporaryAgentContentById[selectedNode.id] || "" : ""}
                onTemporaryRunContentChange={(agentId, value) =>
                  setTemporaryAgentContentById((current) => ({ ...current, [agentId]: value }))
                }
              />
            ) : (
              <AiAssistantPanel
                planning={planning}
                project={project}
                interviews={interviews}
                fieldwork={fieldwork}
                findings={findings}
                report={report}
                busy={busy}
              />
            )}
          </div>
        </section>
        </>
      ) : null}

      {activeScreen === "Planning" && planning ? (
        <PlanningScreen
          planning={planning}
          onChange={(next) => run(() => planningApi.update(projectId, next))}
          onApprove={() => {
            setFieldworkCreateMode("missing");
            setShowApprovePlanning(true);
          }}
          onReopen={() => run(() => planningApi.reopen(projectId))}
        />
      ) : null}
      {activeScreen === "Interviews" && interviews ? (
        <InterviewsScreen
          plan={interviews}
          onGenerate={() => run(() => interviewsApi.generatePlan(projectId))}
          agentExecutionEnabled={runtime?.agentExecutionEnabled ?? true}
          onChange={(next) => run(() => interviewsApi.update(projectId, next))}
        />
      ) : null}
      {activeScreen === "Fieldwork" && fieldwork ? (
        <FieldworkScreen
          planning={planning}
          fieldwork={fieldwork}
          findings={findings}
          onChange={(next) => run(() => fieldworkApi.update(projectId, next))}
          onRefineFinding={(description, itemId) => findingsApi.refine(projectId, description, itemId)}
          onCreateFinding={(finding) => run(() => findingsApi.create(projectId, finding))}
          onSaveFindings={(next) => run(() => findingsApi.update(projectId, next))}
          onDeleteFinding={(findingId) => run(() => findingsApi.delete(projectId, findingId))}
          agentExecutionEnabled={runtime?.agentExecutionEnabled ?? true}
        />
      ) : null}
      {activeScreen === "Reporting" && report && findings ? (
        <ReportingScreen
          report={report}
          findings={findings}
          onGenerate={() => run(() => reportsApi.generateDraftReport(projectId))}
          onOpenReport={openReportAttachment}
          agentExecutionEnabled={runtime?.agentExecutionEnabled ?? true}
        />
      ) : null}
      {activeScreen === "Settings" && project ? (
        <SettingsScreen
          projectId={projectId}
          projectTitle={project.title}
          onDeleted={onReset}
          onRuntimeChanged={onRuntimeChanged}
          runtime={runtime}
          onViewAgentRunLogs={() => setActiveScreen("Agent Logs")}
        />
      ) : null}
      {activeScreen === "Agent Logs" && project ? <AgentRunLogsScreen projectId={projectId} projectTitle={project.title} /> : null}

      {pendingAgentRun ? (
        <Modal title="Existing outputs found" onClose={() => setPendingAgentRun(null)}>
          <div className="modal-body">
            <p>
              Some connected cards already have outputs from this type of agent. Choose whether to keep them, replace them, or cancel this run.
            </p>
            <div className="conflict-list">
              {pendingAgentRun.conflicts.map((conflict) => (
                <div key={conflict.input_node_id} className="conflict-item">
                  <strong>{conflict.input_title}</strong>
                  <span>{conflict.outputs.length} existing output{conflict.outputs.length === 1 ? "" : "s"}</span>
                  <ul>
                    {conflict.outputs.slice(0, 6).map((output) => (
                      <li key={output.id}>{output.title}</li>
                    ))}
                  </ul>
                  {conflict.outputs.length > 6 ? <small>+{conflict.outputs.length - 6} more</small> : null}
                </div>
              ))}
            </div>
            <div className="button-row modal-actions">
              <Button variant="ghost" onClick={() => setPendingAgentRun(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() =>
                  executeAgentRun(
                    pendingAgentRun.agentId,
                    pendingAgentRun.inputNodeIds,
                    "replace",
                    pendingAgentRun.roughFindingText || "",
                    pendingAgentRun.temporaryContent || ""
                  )
                }
                disabled={busy}
              >
                Delete outputs and create new
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  executeAgentRun(
                    pendingAgentRun.agentId,
                    pendingAgentRun.inputNodeIds,
                    "append",
                    pendingAgentRun.roughFindingText || "",
                    pendingAgentRun.temporaryContent || ""
                  )
                }
                disabled={busy}
              >
                Keep old and add new
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {pendingFindingAgentRun ? (
        <Modal title="Draft issue from fieldwork" onClose={() => setPendingFindingAgentRun(null)}>
          <div className="modal-body">
            <p>Choose the fieldwork test card this issue relates to, then describe the rough issue or exception. The Finding Draft Agent will create one linked issue and recommendation.</p>
            {pendingFindingAgentRun.inputNodeIds.length > 1 ? (
              <Select
                label="Fieldwork test card"
                value={pendingFindingAgentRun.selectedInputNodeId}
                onChange={(event) =>
                  setPendingFindingAgentRun((current) => (current ? { ...current, selectedInputNodeId: event.target.value } : current))
                }
              >
                {pendingFindingAgentRun.inputNodeIds.map((nodeId) => {
                  const inputNode = map?.nodes.find((node) => node.id === nodeId);
                  return <option key={nodeId} value={nodeId}>{inputNode?.data.title || nodeId}</option>;
                })}
              </Select>
            ) : null}
            <TextArea
              label="Rough issue description"
              rows={5}
              value={findingAgentText}
              onChange={(event) => setFindingAgentText(event.target.value)}
              placeholder="Example: Approval evidence was missing for two sampled items, and the process owner could not explain the exception review."
            />
            <div className="button-row modal-actions">
              <Button variant="ghost" onClick={() => setPendingFindingAgentRun(null)}>Cancel</Button>
              <Button onClick={submitFindingAgentRun} disabled={busy || !findingAgentText.trim()}>Run Agent</Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {reportAttachmentNodeId ? (
        <Modal
          title={reportAttachmentNodeId === "executive-summary" ? "Executive Summary" : "Draft Report"}
          onClose={() => setReportAttachmentNodeId(null)}
          className="report-attachment-shell"
        >
          <div className="modal-body report-attachment-modal">
            <div className="markdown-preview report-modal-preview">
              {renderMarkdownPreview(
                reportAttachmentDraft ||
                  (reportAttachmentNodeId === "executive-summary"
                    ? "Generate the executive summary, then edit it here."
                    : "Generate the draft report, then edit the markdown here.")
              )}
            </div>
            <TextArea
              label={reportAttachmentNodeId === "executive-summary" ? "Edit executive summary" : "Edit markdown report"}
              rows={16}
              value={reportAttachmentDraft}
              onChange={(event) => setReportAttachmentDraft(event.target.value)}
            />
            <div className="button-row modal-actions">
              <Button variant="ghost" onClick={() => setReportAttachmentNodeId(null)}>Cancel</Button>
              <Button onClick={saveReportAttachment} disabled={busy}>
                {reportAttachmentNodeId === "executive-summary" ? "Save Executive Summary" : "Save Report"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {showApprovePlanning ? (
        <Modal title={hasFieldworkItems ? "Fieldwork items already exist for this planning" : "Approve planning and create fieldwork?"} onClose={() => setShowApprovePlanning(false)}>
          <div className="modal-body">
            {hasFieldworkItems ? (
              <>
                <p>Fieldwork items already exist for this planning.</p>
                <label className="check-row">
                  <input
                    type="radio"
                    checked={fieldworkCreateMode === "keep"}
                    onChange={() => setFieldworkCreateMode("keep")}
                  />
                  <span>Keep existing fieldwork items</span>
                </label>
                <label className="check-row">
                  <input
                    type="radio"
                    checked={fieldworkCreateMode === "missing"}
                    onChange={() => setFieldworkCreateMode("missing")}
                  />
                  <span>Create only missing fieldwork items</span>
                </label>
                <label className="check-row">
                  <input
                    type="radio"
                    checked={fieldworkCreateMode === "replace"}
                    onChange={() => setFieldworkCreateMode("replace")}
                  />
                  <span>Replace fieldwork items created from planning</span>
                </label>
              </>
            ) : (
              <>
                <p>This will create fieldwork items from all current test cards.</p>
                <p>Your planning cards will remain unchanged. You can then focus on Fieldwork using the phase filters.</p>
              </>
            )}
            <div className="button-row modal-actions">
              <Button variant="ghost" onClick={() => setShowApprovePlanning(false)}>Cancel</Button>
              <Button variant="secondary" onClick={() => approvePlanning(false)} disabled={busy}>Approve Only</Button>
              <Button onClick={() => approvePlanning(true, hasFieldworkItems ? fieldworkCreateMode : "missing")} disabled={busy}>
                Approve & Create Fieldwork
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      <BrandingFooter />
    </main>
  );
}
