import type { ReactNode } from "react";
import { downloadBlob } from "./engine/source";
import { ExportButton } from "./FindingDetail";

/** Renders the report's Markdown subset (headings, bullet lists, paragraphs, **bold**). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

function render(markdown: string) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>);
    list = [];
  };
  markdown.split("\n").forEach((line, i) => {
    if (line.startsWith("- ")) { list.push(line.slice(2)); return; }
    flush();
    if (line.startsWith("### ")) blocks.push(<h4 key={i}>{inline(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={i}>{inline(line.slice(3))}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={i}>{inline(line.slice(2))}</h2>);
    else if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return blocks;
}

export function ReportView({ markdown, fileName }: { markdown: string; fileName: string }) {
  const name = `data-quality-report-${fileName.replace(/\.[^.]+$/, "")}.md`;
  return (
    <div className="dq-detail">
      <div className="dq-section-head">
        <span className="muted dq-hint">Built from the test results with standard sentences.</span>
        <ExportButton label="Download Markdown" title={`Download ${name}`} onClick={() => downloadBlob(new Blob([markdown], { type: "text/markdown" }), name)} />
      </div>
      <article className="dq-report">{render(markdown)}</article>
    </div>
  );
}
