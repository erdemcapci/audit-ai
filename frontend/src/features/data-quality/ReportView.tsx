import type { ReactNode } from "react";
import { downloadBlob } from "./engine/source";
import { ExportButton } from "./FindingDetail";

/** Sections that back up the summary; collapsed by default so the top of the report stays short. */
const COLLAPSED = new Set(["Finding details", "AI recommended actions", "AI interpretation details", "Tests without findings", "Not tested", "AI review of the test plan", "Changes to the standard plan", "Columns", "Settings"]);

/** Renders the report's Markdown subset (headings, lists, tables, paragraphs, **bold**, _italic_). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|(?<!\w)_[^_\n]+_(?!\w))/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part.length > 2 && part.startsWith("_") && part.endsWith("_") ? <em key={i}>{part.slice(1, -1)}</em>
    : part);
}

const cells = (row: string) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function renderBlock(lines: string[], keyBase: string) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  let table: string[] = [];
  const flushList = () => {
    if (list.length) {
      const items = list.map((item, i) => <li key={i}>{inline(item)}</li>);
      blocks.push(ordered ? <ol key={`${keyBase}-l${blocks.length}`}>{items}</ol> : <ul key={`${keyBase}-l${blocks.length}`}>{items}</ul>);
    }
    list = [];
  };
  const flushTable = () => {
    if (table.length) {
      const [head, align, ...body] = table;
      const right = cells(align).map((c) => c.endsWith(":"));
      blocks.push(
        <div className="dq-table-wrap" key={`${keyBase}-t${blocks.length}`}>
          <table className="dq-table dq-report-table">
            <thead><tr>{cells(head).map((c, i) => <th key={i} className={right[i] ? "dq-num" : ""}>{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((row, r) => <tr key={r}>{cells(row).map((c, i) => <td key={i} className={right[i] ? "dq-num" : ""}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    table = [];
  };
  lines.forEach((line, i) => {
    if (line.startsWith("|")) { flushList(); table.push(line); return; }
    flushTable();
    const bullet = line.startsWith("- ");
    const number = /^\d+\. /.test(line);
    if (bullet || number) {
      if (list.length && ordered !== number) flushList();
      ordered = number;
      list.push(bullet ? line.slice(2) : line.replace(/^\d+\. /, ""));
      return;
    }
    flushList();
    if (line.startsWith("### ")) blocks.push(<h4 key={`${keyBase}-${i}`}>{inline(line.slice(4))}</h4>);
    else if (line.trim()) blocks.push(<p key={`${keyBase}-${i}`}>{inline(line)}</p>);
  });
  flushList();
  flushTable();
  return blocks;
}

function render(markdown: string) {
  const lines = markdown.split("\n");
  const out: ReactNode[] = [];
  let title = "";
  let body: string[] = [];
  const flush = () => {
    if (!title && !body.length) return;
    const key = `s${out.length}`;
    if (COLLAPSED.has(title)) out.push(<details className="dq-report-more" key={key}><summary>{title}</summary>{renderBlock(body, key)}</details>);
    else out.push(<section key={key} className={title === "Summary" ? "dq-report-summary" : undefined}>{title ? <h3>{title}</h3> : null}{renderBlock(body, key)}</section>);
    title = ""; body = [];
  };
  lines.forEach((line) => {
    if (line.startsWith("## ")) { flush(); title = line.slice(3); }
    else if (line.startsWith("# ")) { flush(); out.push(<h2 key={`h${out.length}`}>{inline(line.slice(2))}</h2>); }
    else body.push(line);
  });
  flush();
  return out;
}

export function ReportView({ markdown, fileName, interpreted = false }: { markdown: string; fileName: string; interpreted?: boolean }) {
  const name = `data-quality-report-${fileName.replace(/\.[^.]+$/, "")}.md`;
  return (
    <div className="dq-detail">
      <div className="dq-section-head">
        <span className="muted dq-hint">{interpreted ? "Summary and tables are built from the test results; the “AI interpretation” section was written by AI." : "Built from the test results."}</span>
        <ExportButton label="Download Markdown" title={`Download ${name}`} onClick={() => downloadBlob(new Blob([markdown], { type: "text/markdown" }), name)} />
      </div>
      <article className="dq-report">{render(markdown)}</article>
    </div>
  );
}
