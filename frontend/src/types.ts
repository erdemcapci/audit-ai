export type StatusBadge =
  | "AI Generated"
  | "Edited"
  | "Confirmed"
  | "Draft"
  | "In Progress"
  | "Issue Found"
  | "Ready for Report";

export type AuditProject = {
  id: string;
  slug: string;
  title: string;
  description: string;
  process_area: string;
  initial_concern: string;
  extra_context: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AuditCreate = {
  title: string;
  description: string;
  process_area?: string;
  initial_concern?: string;
  extra_context?: string;
};

export type Test = {
  id: string;
  title: string;
  test_type: string;
  test_objective: string;
  description: string;
  expected_evidence: string;
  sample_considerations: string;
  status: StatusBadge;
};

export type Risk = {
  id: string;
  title: string;
  description: string;
  why_it_matters: string;
  potential_impact: string;
  severity: string;
  status: StatusBadge;
  tests: Test[];
};

export type Objective = {
  id: string;
  title: string;
  description: string;
  scope_notes: string;
  rationale: string;
  status: StatusBadge;
  risks: Risk[];
};

export type Workstream = {
  id: string;
  name: string;
  description: string;
  rationale: string;
  status: StatusBadge;
  objectives: Objective[];
};

export type PlanningState = {
  version: number;
  stage: string;
  approved: boolean;
  workstreams: Workstream[];
  assumptions: string[];
  open_questions: string[];
};

export type InterviewQuestion = {
  id: string;
  question_text: string;
  mapped_objective_id: string | null;
  mapped_risk_id: string | null;
  mapped_test_id: string | null;
  status: StatusBadge;
};

export type InterviewRole = {
  id: string;
  role_title: string;
  rationale: string;
  expected_information: string;
  notes: string;
  questions: InterviewQuestion[];
  status: StatusBadge;
};

export type InterviewPlan = {
  roles: InterviewRole[];
};

export type FieldworkItem = {
  id: string;
  test_id: string;
  source_test_id?: string | null;
  title: string;
  test_type: string;
  description: string;
  expected_evidence: string;
  status: string;
  notes: string;
  evidence_placeholder: string;
  finding_ids: string[];
};

export type FieldworkState = {
  items: FieldworkItem[];
};

export type Finding = {
  id: string;
  title: string;
  raw_description: string;
  issue: string;
  criteria: string;
  root_cause: string;
  impact: string;
  recommendation: string;
  management_action: string;
  severity: string;
  evidence_needed: string[];
  validation_questions: string[];
  linked_fieldwork_item_id: string | null;
  status: StatusBadge;
};

export type FindingsState = {
  findings: Finding[];
};

export type ReportState = {
  executive_summary: string;
  audit_conclusion: string;
  key_themes: string[];
  issue_summary: string;
  management_attention_points: string[];
  draft_report_structure: Array<{ heading?: string; content?: string }>;
  ai_improved_version: string;
  draft_markdown: string;
};

export type FlowNodeData = {
  title: string;
  description: string;
  status: StatusBadge | string;
  count?: number;
  severity?: string;
  testType?: string;
  itemStatus?: string;
  phase?: string;
  fieldworkSection?: string;
  width?: number;
  height?: number;
  projectId?: string;
  agentType?: string;
  config?: Record<string, unknown>;
  lastRunAt?: string | null;
  lastError?: string;
  lastOutput?: Record<string, unknown>;
  inputCount?: number;
  onRunAgent?: (agentId: string, inputNodeIds?: string[]) => void;
  onPhaseResize?: (nodeId: string, dimensions: { width: number; height: number }) => void;
  onNodeResize?: (nodeId: string, dimensions: { width: number; height: number }) => void;
  isSelected?: boolean;
  rationale?: string;
  scope_notes?: string;
  why_it_matters?: string;
  potential_impact?: string;
  test_type?: string;
  test_objective?: string;
  expected_evidence?: string;
  sample_considerations?: string;
  expected_information?: string;
  notes?: string;
  question_text?: string;
  requested_from?: string;
  expected_document?: string;
  source_node_id?: string | null;
  source_test_id?: string | null;
  evidence_placeholder?: string;
  issue?: string;
  criteria?: string;
  root_cause?: string;
  impact?: string;
  recommendation?: string;
  management_action?: string;
  executive_summary?: string;
  audit_conclusion?: string;
  issue_summary?: string;
  draft_markdown?: string;
};

export type AuditMapResponse = {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; width?: number; height?: number; data: FlowNodeData }>;
  edges: Array<{ id: string; source: string; target: string; type: string; animated: boolean; data?: Record<string, unknown> }>;
};

export type PhaseLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AgentDefinition = {
  type: string;
  title: string;
  description: string;
  default_prompt: string;
  default_config: Record<string, unknown>;
  allowed_input_node_types: string[];
  output_node_types: string[];
};

export type AgentState = {
  id: string;
  type: string;
  title: string;
  prompt: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  status: "idle" | "ready" | "running" | "completed" | "error";
  last_run_at: string | null;
  last_error: string;
  last_output: Record<string, unknown>;
};

export type AgentRunMode = "append" | "replace";

export type AgentOutputItem = {
  id: string;
  type: string;
  title: string;
};

export type AgentOutputConflict = {
  input_node_id: string;
  input_title: string;
  outputs: AgentOutputItem[];
};

export type AgentOutputCheckResponse = {
  conflicts: AgentOutputConflict[];
};

export type MapStateUpdate = {
  phaseLayouts?: Record<string, PhaseLayout>;
  nodePositions?: Record<string, { x: number; y: number }>;
  nodeDimensions?: Record<string, { width: number; height: number }>;
  edges?: AuditMapResponse["edges"];
  agents?: AgentState[];
};

export type BulkDeleteRequest = {
  phase: "planning" | "fieldwork" | "reporting";
  dimension: string;
};

export type AutoLayoutConfig = {
  horizontal_gap: number;
  vertical_gap: number;
  card_width: number;
  phase_gap: number;
};
