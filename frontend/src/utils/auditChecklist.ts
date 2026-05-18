import type { AuditProject, FieldworkState, FindingsState, InterviewPlan, PlanningState, ReportState } from "../types";

export type AuditChecklistStatus = "completed" | "active" | "locked";

export type AuditChecklistActionId =
  | "generateObjectives"
  | "generateRisks"
  | "generateTests"
  | "approvePlanning"
  | "generateInterviews"
  | "createFieldwork"
  | "draftFinding"
  | "generateExecutiveSummary"
  | "generateDraftReport";

export type AuditChecklistItem = {
  id: string;
  section: string;
  label: string;
  status: AuditChecklistStatus;
  actionId?: AuditChecklistActionId;
};

export type AuditChecklistState = {
  items: AuditChecklistItem[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
};

function hasObjectives(planning: PlanningState | null): boolean {
  return Boolean(planning?.workstreams.some((workstream) => workstream.objectives.length > 0));
}

function hasRisks(planning: PlanningState | null): boolean {
  return Boolean(planning?.workstreams.some((workstream) => workstream.objectives.some((objective) => objective.risks.length > 0)));
}

function hasTests(planning: PlanningState | null): boolean {
  return Boolean(
    planning?.workstreams.some((workstream) =>
      workstream.objectives.some((objective) => objective.risks.some((risk) => risk.tests.length > 0))
    )
  );
}

export function deriveAuditChecklistState({
  project,
  planning,
  interviews,
  fieldwork,
  findings,
  report
}: {
  project: AuditProject | null;
  planning: PlanningState | null;
  interviews: InterviewPlan | null;
  fieldwork: FieldworkState | null;
  findings: FindingsState | null;
  report: ReportState | null;
}): AuditChecklistState {
  const auditExists = Boolean(project?.title?.trim() && project?.description?.trim());
  const objectivesExist = hasObjectives(planning);
  const risksExist = hasRisks(planning);
  const testsExist = hasTests(planning);
  const planningApproved = Boolean(planning?.approved);
  const interviewsExist = Boolean(interviews?.roles.length);
  const fieldworkExists = Boolean(fieldwork?.items.length);
  const findingsExist = Boolean(findings?.findings.length);
  const executiveSummaryExists = Boolean(report?.executive_summary?.trim());
  const draftReportExists = Boolean(report?.audit_conclusion?.trim() || report?.issue_summary?.trim() || report?.draft_report_structure.length);

  const items: AuditChecklistItem[] = [
    {
      id: "start-audit",
      section: "Planning",
      label: "Add audit title and description",
      status: auditExists ? "completed" : "active"
    },
    {
      id: "generate-objectives",
      section: "Planning",
      label: "Generate objectives",
      status: objectivesExist ? "completed" : auditExists ? "active" : "locked",
      actionId: "generateObjectives"
    },
    {
      id: "generate-risks",
      section: "Planning",
      label: "Confirm objectives & generate risks",
      status: risksExist ? "completed" : objectivesExist ? "active" : "locked",
      actionId: "generateRisks"
    },
    {
      id: "generate-tests",
      section: "Planning",
      label: "Confirm risks & generate tests",
      status: testsExist ? "completed" : risksExist ? "active" : "locked",
      actionId: "generateTests"
    },
    {
      id: "approve-planning",
      section: "Planning",
      label: "Approve planning",
      status: planningApproved ? "completed" : testsExist ? "active" : "locked",
      actionId: "approvePlanning"
    },
    {
      id: "generate-interviews",
      section: "Interviews",
      label: "Generate interview plan",
      status: interviewsExist ? "completed" : objectivesExist ? "active" : "locked",
      actionId: "generateInterviews"
    },
    {
      id: "create-fieldwork",
      section: "Fieldwork",
      label: "Create fieldwork items",
      status: fieldworkExists ? "completed" : planningApproved ? "active" : "locked",
      actionId: "createFieldwork"
    },
    {
      id: "draft-finding",
      section: "Findings",
      label: "Draft at least one finding",
      status: findingsExist ? "completed" : fieldworkExists ? "active" : "locked",
      actionId: "draftFinding"
    },
    {
      id: "generate-executive-summary",
      section: "Reporting",
      label: "Generate executive summary",
      status: executiveSummaryExists ? "completed" : findingsExist ? "active" : "locked",
      actionId: "generateExecutiveSummary"
    },
    {
      id: "generate-draft-report",
      section: "Reporting",
      label: "Generate draft report",
      status: draftReportExists ? "completed" : executiveSummaryExists ? "active" : "locked",
      actionId: "generateDraftReport"
    }
  ];

  const completedCount = items.filter((item) => item.status === "completed").length;
  const totalCount = items.length;

  return {
    items,
    completedCount,
    totalCount,
    progressPercent: totalCount ? Math.round((completedCount / totalCount) * 100) : 0
  };
}
