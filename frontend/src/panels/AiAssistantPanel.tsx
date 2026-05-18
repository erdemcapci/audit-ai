import { useState } from "react";
import type { AuditProject, FieldworkState, FindingsState, InterviewPlan, PlanningState, ReportState } from "../types";
import { deriveAuditChecklistState } from "../utils/auditChecklist";

export function AiAssistantPanel({
  project,
  planning,
  interviews,
  fieldwork,
  findings,
  report,
  busy
}: {
  project: AuditProject | null;
  planning: PlanningState | null;
  interviews: InterviewPlan | null;
  fieldwork: FieldworkState | null;
  findings: FindingsState | null;
  report: ReportState | null;
  busy: boolean;
}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Planning: true
  });
  const checklist = deriveAuditChecklistState({ project, planning, interviews, fieldwork, findings, report });
  const sections = Array.from(new Set(checklist.items.map((item) => item.section)));

  return (
    <aside className="assistant-panel">
      <div>
        <span className="detail-kicker">Guided audit checklist</span>
        <h2>{checklist.completedCount} of {checklist.totalCount} actions complete</h2>
        <div className="checklist-progress">
          <span style={{ width: `${checklist.progressPercent}%` }} />
        </div>
      </div>

      <div className="audit-checklist">
        {sections.map((section) => {
          const items = checklist.items.filter((item) => item.section === section);
          const completed = items.filter((item) => item.status === "completed").length;
          const active = items.some((item) => item.status === "active");
          const locked = items.every((item) => item.status === "locked");
          const expanded = Boolean(openSections[section]);
          return (
            <div key={section} className={`checklist-group ${active ? "active" : locked ? "locked" : "completed"}`}>
              <button
                type="button"
                className="checklist-group-header"
                onClick={() => setOpenSections((current) => ({ ...current, [section]: !expanded }))}
              >
                <span>{expanded ? "▾" : "▸"}</span>
                <strong>{section}</strong>
                <em>{completed}/{items.length}</em>
              </button>
              {expanded ? (
                <div className="checklist-children">
                  {items.map((item, index) => (
                    <div key={item.id} className={`checklist-item ${item.status}`}>
                      <div className="checklist-index">{index + 1}</div>
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.status === "active" ? "Next action" : item.status}</span>
                      </div>
                      <em>{item.status === "completed" ? "Done" : busy && item.status === "active" ? "Working" : ""}</em>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="muted">
        AI generation runs from visible agent cards on the map. Use this checklist to track the audit path; edit and review cards directly in the map.
      </p>
    </aside>
  );
}
