import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import type { FindingsState, ReportState } from "../types";

export function ReportingScreen({
  report,
  findings,
  onGenerate,
  onOpenReport
}: {
  report: ReportState;
  findings: FindingsState;
  onGenerate: () => Promise<void>;
  onOpenReport: (nodeId: string) => void;
}) {
  const findingCount = findings.findings.length;
  const draftSectionCount = report.draft_report_structure.length;

  return (
    <section className="screen-panel">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Reporting</p>
          <h2>Report attachments</h2>
        </div>
        <Button onClick={onGenerate}>Generate Draft Report</Button>
      </header>
      {!report.executive_summary && !report.draft_markdown ? (
        <EmptyState title="No report draft yet" description="Generate reporting content from planning, fieldwork, and findings." />
      ) : null}
      <div className="report-attachment-grid">
        <Card className="report-attachment-card">
          <div>
            <p className="eyebrow">Attachment</p>
            <h3>Executive Summary</h3>
            <p>{report.executive_summary ? "Formatted executive summary is ready to open and edit." : "Generate reporting content, then open this attachment to edit the executive summary."}</p>
          </div>
          <div className="attachment-meta">
            <span>{findingCount} finding{findingCount === 1 ? "" : "s"} in context</span>
          </div>
          <Button onClick={() => onOpenReport("executive-summary")}>Open Executive Summary</Button>
        </Card>
        <Card className="report-attachment-card">
          <div>
            <p className="eyebrow">Attachment</p>
            <h3>Draft Report</h3>
            <p>{report.draft_markdown ? "Markdown report attachment is ready to open, review, and edit." : "Generate a draft report to create the editable markdown report attachment."}</p>
          </div>
          <div className="attachment-meta">
            <span>{draftSectionCount} draft section{draftSectionCount === 1 ? "" : "s"}</span>
          </div>
          <Button onClick={() => onOpenReport("report-main")}>Open Draft Report</Button>
        </Card>
      </div>
    </section>
  );
}
