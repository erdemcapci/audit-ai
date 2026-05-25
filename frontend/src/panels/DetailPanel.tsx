import { useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";
import { settingsApi, type LlmSettings } from "../api/settingsApi";
import type { AgentDefinition, FlowNodeData } from "../types";

type Draft = Record<string, string>;

const agentPreviewFields = new Set(["title", "prompt"]);

const phaseDimensionOptions: Record<string, Array<{ value: string; label: string; warning: string }>> = {
  planning: [
    { value: "testNode", label: "Tests", warning: "Delete all test cards in Planning." },
    { value: "riskNode", label: "Risks and tests", warning: "Delete all risk cards and their tests in Planning." },
    { value: "objectiveNode", label: "Objectives, risks, and tests", warning: "Delete all objective cards and everything under them in Planning." },
    { value: "workstreamNode", label: "Workstreams and all planning cards", warning: "Delete all workstreams, objectives, risks, and tests." },
    { value: "agentNode", label: "Agent cards", warning: "Delete all agent cards currently in Planning." }
  ],
  fieldwork: [
    { value: "interviewQuestionNode", label: "Interview questions", warning: "Delete all interview question cards in Fieldwork." },
    { value: "interviewRoleNode", label: "Interview roles and questions", warning: "Delete all interview role cards and their questions." },
    { value: "fieldworkItemNode", label: "Fieldwork items", warning: "Delete all fieldwork item cards." },
    { value: "documentRequestNode", label: "Document requests", warning: "Delete all document request cards." },
    { value: "findingNode", label: "Findings", warning: "Delete all finding cards." },
    { value: "fieldwork_all", label: "All fieldwork cards", warning: "Delete interviews, fieldwork items, document requests, and findings." },
    { value: "agentNode", label: "Agent cards", warning: "Delete all agent cards currently in Fieldwork." }
  ],
  reporting: [
    { value: "reportNode", label: "Report cards", warning: "Clear report card content." },
    { value: "agentNode", label: "Agent cards", warning: "Delete all agent cards currently in Reporting." }
  ]
};

const fieldMap: Record<string, Array<{ key: string; label: string; kind?: "textarea" | "select"; options?: string[] }>> = {
  auditNode: [
    { key: "title", label: "Audit title" },
    { key: "description", label: "Description", kind: "textarea" }
  ],
  workstreamNode: [
    { key: "title", label: "Workstream name" },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "rationale", label: "Rationale", kind: "textarea" }
  ],
  objectiveNode: [
    { key: "title", label: "Objective title" },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "rationale", label: "Rationale", kind: "textarea" },
    { key: "scope_notes", label: "Scope notes", kind: "textarea" }
  ],
  riskNode: [
    { key: "title", label: "Risk title" },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "why_it_matters", label: "Why it matters", kind: "textarea" },
    { key: "potential_impact", label: "Potential impact", kind: "textarea" },
    { key: "severity", label: "Severity", kind: "select", options: ["Low", "Medium", "High"] }
  ],
  testNode: [
    { key: "title", label: "Test title" },
    { key: "test_type", label: "Test type", kind: "select", options: ["Test of Design", "Test of Operating Effectiveness", "Detailed Test", "Analytical Review", "Inquiry / Interview"] },
    { key: "test_objective", label: "Test objective", kind: "textarea" },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "expected_evidence", label: "Expected evidence", kind: "textarea" },
    { key: "sample_considerations", label: "Sample considerations", kind: "textarea" }
  ],
  fieldworkItemNode: [
    { key: "title", label: "Fieldwork title" },
    { key: "status", label: "Status", kind: "select", options: ["Not Started", "In Progress", "Completed", "Issue Identified"] },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "expected_evidence", label: "Expected evidence", kind: "textarea" },
    { key: "notes", label: "Notes", kind: "textarea" }
  ],
  documentRequestNode: [
    { key: "title", label: "Request title" },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "requested_from", label: "Requested from" },
    { key: "expected_document", label: "Expected document", kind: "textarea" },
    { key: "rationale", label: "Rationale", kind: "textarea" }
  ],
  findingNode: [
    { key: "title", label: "Finding title" },
    { key: "issue", label: "Issue / condition", kind: "textarea" },
    { key: "criteria", label: "Criteria", kind: "textarea" },
    { key: "root_cause", label: "Root cause", kind: "textarea" },
    { key: "impact", label: "Impact / risk", kind: "textarea" },
    { key: "recommendation", label: "Recommendation", kind: "textarea" },
    { key: "severity", label: "Severity", kind: "select", options: ["Low", "Medium", "High"] }
  ],
  interviewRoleNode: [
    { key: "title", label: "Role title" },
    { key: "expected_information", label: "Expected information", kind: "textarea" },
    { key: "rationale", label: "Rationale", kind: "textarea" },
    { key: "notes", label: "Interview notes", kind: "textarea" }
  ],
  interviewQuestionNode: [{ key: "question_text", label: "Question", kind: "textarea" }]
};

function bulkTargetForNode(node: Node<FlowNodeData>): { phase: "planning" | "fieldwork" | "reporting"; dimension: string; label: string; warning: string } | null {
  switch (node.type) {
    case "workstreamNode":
      return { phase: "planning", dimension: "workstreamNode", label: "Workstreams and all planning cards", warning: "Delete all workstreams, objectives, risks, and tests." };
    case "objectiveNode":
      return { phase: "planning", dimension: "objectiveNode", label: "Objectives, risks, and tests", warning: "Delete all objective cards and everything under them in Planning." };
    case "riskNode":
      return { phase: "planning", dimension: "riskNode", label: "Risks and tests", warning: "Delete all risk cards and their tests in Planning." };
    case "testNode":
      return { phase: "planning", dimension: "testNode", label: "Tests", warning: "Delete all test cards in Planning." };
    case "interviewRoleNode":
      return { phase: "fieldwork", dimension: "interviewRoleNode", label: "Interview roles and questions", warning: "Delete all interview roles and their questions." };
    case "interviewQuestionNode":
      return { phase: "fieldwork", dimension: "interviewQuestionNode", label: "Interview questions", warning: "Delete all interview question cards." };
    case "fieldworkItemNode":
      return { phase: "fieldwork", dimension: "fieldworkItemNode", label: "Fieldwork items", warning: "Delete all fieldwork item cards." };
    case "documentRequestNode":
      return { phase: "fieldwork", dimension: "documentRequestNode", label: "Document requests", warning: "Delete all document request cards." };
    case "findingNode":
      return { phase: "fieldwork", dimension: "findingNode", label: "Findings", warning: "Delete all finding cards." };
    case "reportNode":
      return { phase: "reporting", dimension: "reportNode", label: "Report cards", warning: "Clear report card content." };
    default:
      return null;
  }
}

function initialDraft(node: Node<FlowNodeData>): Draft {
  if (node.type === "phaseNode") {
    return {
      x: String(node.position.x),
      y: String(node.position.y),
      width: String(node.data.width || 800),
      height: String(node.data.height || 900)
    };
  }
  if (node.type === "agentNode") {
    const config = node.data.config || {};
    return {
      title: node.data.title || "",
      prompt: node.data.description || "",
      output_mode: String(config.output_mode ?? "json"),
      max_output_items: String(config.max_output_items ?? ""),
      workstreams_count: String(config.workstreams_count ?? ""),
      objectives_per_workstream: String(config.objectives_per_workstream ?? ""),
      tests_per_risk: String(config.tests_per_risk ?? ""),
      risks_per_objective: String(config.risks_per_objective ?? ""),
      allowed_test_types: Array.isArray(config.allowed_test_types) ? config.allowed_test_types.join(", ") : "",
      questions_per_role: String(config.questions_per_role ?? ""),
      max_roles: String(config.max_roles ?? ""),
      tone: String(config.tone ?? ""),
      report_style: String(config.report_style ?? "")
    };
  }
  return {
    title: node.data.title || "",
    description: node.data.description || "",
    severity: node.data.severity || "",
    test_type: node.data.testType || "",
    status: node.data.itemStatus || "",
    executive_summary: node.data.description || "",
    question_text: node.data.title || "",
    rationale: node.data.rationale || "",
    scope_notes: node.data.scope_notes || "",
    why_it_matters: node.data.why_it_matters || "",
    potential_impact: node.data.potential_impact || "",
    test_objective: node.data.test_objective || "",
    expected_evidence: node.data.expected_evidence || "",
    sample_considerations: node.data.sample_considerations || "",
    expected_information: node.data.expected_information || "",
    notes: node.data.notes || "",
    issue: node.data.issue || node.data.description || "",
    criteria: node.data.criteria || "",
    root_cause: node.data.root_cause || "",
    impact: node.data.impact || "",
    recommendation: node.data.recommendation || "",
    management_action: node.data.management_action || "",
    audit_conclusion: node.data.audit_conclusion || "",
    issue_summary: node.data.issue_summary || "",
    draft_markdown: node.data.draft_markdown || ""
  };
}

function currentProviderLabel(settings: LlmSettings | null): string {
  if (!settings) return "Configured in Settings";
  if (settings.demo_mode) return "Demo mode";
  if (settings.provider === "openai") return "OpenAI";
  if (settings.provider === "claude") return "Claude";
  if (settings.provider === "ollama") return "Ollama";
  return settings.provider;
}

function currentModelLabel(settings: LlmSettings | null): string {
  if (!settings) return "Configured in Settings";
  if (settings.demo_mode) return "Demo data";
  return settings.model;
}

export function DetailPanel({
  node,
  agentTypes,
  onSaveNode,
  onSaveAgent,
  onConnectRelated,
  onDisconnectRelated,
  onPreviewNode,
  onDeleteNode,
  onDeleteOutputs,
  onDeleteDimension,
  onOpenReport,
  temporaryRunContent,
  onTemporaryRunContentChange
}: {
  node: Node<FlowNodeData> | null;
  agentTypes: AgentDefinition[];
  onSaveNode: (nodeId: string, nodeType: string, fields: Record<string, unknown>) => Promise<void>;
  onSaveAgent: (agentId: string, fields: { title?: string; prompt?: string; config?: Record<string, unknown> }) => Promise<void>;
  onConnectRelated: (agentId: string) => Promise<void>;
  onDisconnectRelated: (agentId: string) => Promise<void>;
  onPreviewNode: (nodeId: string, fields: Record<string, string>) => void;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onDeleteOutputs: (nodeId: string) => Promise<void>;
  onDeleteDimension: (phase: "planning" | "fieldwork" | "reporting", dimension: string) => Promise<void>;
  onOpenReport: (nodeId: string) => void;
  temporaryRunContent: string;
  onTemporaryRunContentChange: (agentId: string, value: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [bulkDimension, setBulkDimension] = useState("");
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null);

  useEffect(() => {
    if (!node) return;
    setDraft(initialDraft(node));
    if (node.type === "phaseNode") {
      const phase = node.data.phase || "planning";
      setBulkDimension(phaseDimensionOptions[phase]?.[0]?.value || "");
    }
  }, [node]);

  useEffect(() => {
    if (node?.type !== "agentNode") return;
    settingsApi.get().then(setLlmSettings).catch(() => setLlmSettings(null));
  }, [node?.id, node?.type]);

  const agentDefinition = useMemo(
    () => agentTypes.find((definition) => definition.type === node?.data.agentType),
    [agentTypes, node?.data.agentType]
  );

  if (!node) {
    return null;
  }

  function update(key: string, value: string) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (node && (node.type !== "agentNode" || agentPreviewFields.has(key))) onPreviewNode(node.id, next);
      return next;
    });
  }

  async function save() {
    if (!node) return;
    if (node.type === "agentNode") {
      const config: Record<string, unknown> = { ...(node.data.config || {}) };
      delete config.llm_model;
      delete config.temperature;
      ["max_output_items", "workstreams_count", "objectives_per_workstream", "tests_per_risk", "risks_per_objective", "questions_per_role", "max_roles"].forEach((key) => {
        if (draft[key] !== "") config[key] = Number(draft[key]);
      });
      ["output_mode", "tone", "report_style"].forEach((key) => {
        if (draft[key]) config[key] = draft[key];
      });
      if (draft.allowed_test_types) {
        config.allowed_test_types = draft.allowed_test_types.split(",").map((item) => item.trim()).filter(Boolean);
      }
      await onSaveAgent(node.id, { title: draft.title, prompt: draft.prompt, config });
      return;
    }
    const fields: Record<string, unknown> = {};
    (fieldMap[node.type || ""] || []).forEach((field) => {
      fields[field.key] = ["x", "y", "width", "height"].includes(field.key) ? Number(draft[field.key]) : draft[field.key];
    });
    await onSaveNode(node.id, node.type || "", fields);
  }

  const fields = fieldMap[node.type || ""] || [];
  const canDeleteNode = !["phaseNode", "fieldworkSectionNode", "auditNode"].includes(node.type || "") && !["report-main", "executive-summary"].includes(node.id);
  const canDeleteOutputs = !["phaseNode", "fieldworkSectionNode"].includes(node.type || "");
  const cardBulkTarget = node.type !== "phaseNode" ? bulkTargetForNode(node) : null;

  async function confirmDeleteNode() {
    if (!node || !canDeleteNode) return;
    if (window.confirm("Delete this card and its child cards? This updates the local project files.")) {
      await onDeleteNode(node.id);
    }
  }

  async function confirmDeleteOutputs() {
    if (!node || !canDeleteOutputs) return;
    if (window.confirm("Delete all outputs for this card? The selected card will remain.")) {
      await onDeleteOutputs(node.id);
    }
  }

  async function confirmDeleteDimension() {
    if (!node) return;
    if (node.type === "phaseNode") {
      const phase = node.data.phase;
      if (phase !== "planning" && phase !== "fieldwork" && phase !== "reporting") return;
      const option = phaseDimensionOptions[phase]?.find((item) => item.value === bulkDimension);
      const label = option?.label || bulkDimension;
      if (window.confirm(`Delete ${label} in ${node.data.title}? This updates the local project files.`)) {
        await onDeleteDimension(phase, bulkDimension);
      }
      return;
    }
    if (cardBulkTarget && window.confirm(`Delete all ${cardBulkTarget.label}? ${cardBulkTarget.warning}`)) {
      await onDeleteDimension(cardBulkTarget.phase, cardBulkTarget.dimension);
    }
  }

  const phase = node.type === "phaseNode" ? node.data.phase || "planning" : "";
  const bulkOptions = phaseDimensionOptions[phase] || [];
  const selectedBulkOption = bulkOptions.find((item) => item.value === bulkDimension);

  return (
    <aside className="detail-panel">
      <div className="detail-kicker">{node.type}</div>
      <h2>{node.data.title}</h2>
      {node.type !== "agentNode" ? <Badge>{String(node.data.status)}</Badge> : null}

      {node.type === "agentNode" ? (
        <div className="detail-form">
          <TextInput label="Agent title" value={draft.title || ""} onChange={(event) => update("title", event.target.value)} />
          <TextArea label="Prompt" value={draft.prompt || ""} onChange={(event) => update("prompt", event.target.value)} rows={8} />
          <TextArea
            label="Temporary run content"
            value={temporaryRunContent}
            onChange={(event) => onTemporaryRunContentChange(node.id, event.target.value)}
            rows={4}
            placeholder="Optional context for the next run only. This is not saved on the agent card."
          />
          <dl className="agent-model-summary">
            <dt>Current AI provider</dt>
            <dd>{currentProviderLabel(llmSettings)}</dd>
            <dt>Current AI model</dt>
            <dd>{currentModelLabel(llmSettings)}</dd>
          </dl>
          {node.data.agentType !== "report_draft_agent" ? (
            <div className="agent-connection-actions">
              <Button variant="ghost" onClick={() => onConnectRelated(node.id)}>Connect to related cards</Button>
              <Button variant="ghost" onClick={() => onDisconnectRelated(node.id)}>Disconnect related cards</Button>
            </div>
          ) : null}
          {node.data.agentType !== "report_draft_agent" ? <TextInput label="Max output items" value={draft.max_output_items || ""} onChange={(event) => update("max_output_items", event.target.value)} /> : null}
          {node.data.agentType === "workstream_generator" ? <TextInput label="Number of workstreams" value={draft.workstreams_count || ""} onChange={(event) => update("workstreams_count", event.target.value)} /> : null}
          {node.data.agentType === "objective_generator" ? <TextInput label="Objectives per workstream" value={draft.objectives_per_workstream || ""} onChange={(event) => update("objectives_per_workstream", event.target.value)} /> : null}
          {node.data.agentType === "test_generator" ? (
            <>
              <TextInput label="Tests per risk" value={draft.tests_per_risk || ""} onChange={(event) => update("tests_per_risk", event.target.value)} />
              <TextArea label="Allowed test types" value={draft.allowed_test_types || ""} onChange={(event) => update("allowed_test_types", event.target.value)} rows={3} />
            </>
          ) : null}
          {node.data.agentType === "risk_generator" ? <TextInput label="Risks per objective" value={draft.risks_per_objective || ""} onChange={(event) => update("risks_per_objective", event.target.value)} /> : null}
          {node.data.agentType === "interview_plan_generator" ? (
            <>
              <TextInput label="Questions per role" value={draft.questions_per_role || ""} onChange={(event) => update("questions_per_role", event.target.value)} />
              <TextInput label="Max roles" value={draft.max_roles || ""} onChange={(event) => update("max_roles", event.target.value)} />
            </>
          ) : null}
          {node.data.agentType === "finding_draft_agent" ? (
            <Select label="Tone" value={draft.tone || "internal audit"} onChange={(event) => update("tone", event.target.value)}>
              <option>concise</option>
              <option>detailed</option>
              <option>executive</option>
              <option>internal audit</option>
            </Select>
          ) : null}
          {node.data.agentType === "report_draft_agent" ? (
            <Select label="Report style" value={draft.report_style || "executive"} onChange={(event) => update("report_style", event.target.value)}>
              <option>executive</option>
              <option>detailed</option>
              <option>audit committee</option>
            </Select>
          ) : null}
          <Button onClick={save}>Save Agent</Button>
          <div className="danger-zone">
            <h3>Card cleanup</h3>
            <div className="button-row">
              <Button variant="ghost" onClick={confirmDeleteOutputs}>Delete outputs</Button>
              {canDeleteNode ? <Button variant="danger" onClick={confirmDeleteNode}>Delete card</Button> : null}
            </div>
          </div>
        </div>
      ) : node.type === "phaseNode" || node.type === "fieldworkSectionNode" ? (
        <div className="detail-form">
          <p className="muted">Resize this section by dragging its visible edge or corner handles on the canvas. The size is saved automatically after resize.</p>
          <dl>
            <dt>Position</dt>
            <dd>{Math.round(node.position.x)}, {Math.round(node.position.y)}</dd>
            <dt>Size</dt>
            <dd>{Math.round(Number(node.data.width || 0))} x {Math.round(Number(node.data.height || 0))}</dd>
          </dl>
          {node.type === "phaseNode" ? <div className="danger-zone">
            <h3>Bulk cleanup</h3>
            <p className="muted">Delete a full card dimension from this phase without going through the agent that created it.</p>
            <Select label="Card dimension" value={bulkDimension} onChange={(event) => setBulkDimension(event.target.value)}>
              {bulkOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
            {selectedBulkOption ? <p className="muted">{selectedBulkOption.warning}</p> : null}
            <Button variant="danger" onClick={confirmDeleteDimension} disabled={!bulkDimension}>Delete selected dimension</Button>
          </div> : null}
        </div>
      ) : (
        <div className="detail-form">
          {node.type === "reportNode" ? (
            <div className="report-attachment-row">
              <p className="muted">Open this card as a formatted editable report attachment.</p>
              <Button onClick={() => onOpenReport(node.id)}>
                {node.id === "executive-summary" ? "Open Executive Summary" : "Open Draft Report"}
              </Button>
            </div>
          ) : null}
          {node.type === "reportNode" ? null : fields.map((field) => {
            if (field.kind === "textarea") {
              return <TextArea key={field.key} label={field.label} value={draft[field.key] || ""} onChange={(event) => update(field.key, event.target.value)} rows={field.key === "draft_markdown" ? 14 : 4} />;
            }
            if (field.kind === "select") {
              return (
                <Select key={field.key} label={field.label} value={draft[field.key] || ""} onChange={(event) => update(field.key, event.target.value)}>
                  {(field.options || []).map((option) => <option key={option}>{option}</option>)}
                </Select>
              );
            }
            return <TextInput key={field.key} label={field.label} value={draft[field.key] || ""} onChange={(event) => update(field.key, event.target.value)} />;
          })}
          {node.type === "reportNode" ? null : <Button onClick={save}>{node.type === "phaseNode" ? "Save Section" : "Save Card"}</Button>}
          {canDeleteOutputs ? (
            <div className="danger-zone">
              <h3>Card cleanup</h3>
              <p className="muted">Delete generated child cards, remove this card, or bulk delete every card in this same dimension.</p>
              <div className="button-row cleanup-button-row">
                <Button variant="ghost" onClick={confirmDeleteOutputs}>Delete outputs</Button>
                {canDeleteNode ? <Button variant="danger" onClick={confirmDeleteNode}>Delete card</Button> : null}
              </div>
              {cardBulkTarget ? (
                <div className="bulk-delete-row">
                  <Button variant="ghost" onClick={confirmDeleteDimension}>Delete all {cardBulkTarget.label}</Button>
                  <p className="muted">{cardBulkTarget.warning}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
