import { useState } from "react";
import { downloadBlob, recordsCsv } from "./engine/source";
import type { ResultCard } from "./engine/types";
import { ExportButton } from "./FindingDetail";

const PAGE = 200;

/** Exception table for any result card. Shows every record when the source file is loaded, else the saved examples. */
export function RecordsDetail({ card, complete }: { card: ResultCard; complete: boolean }) {
  const rows = complete && card.records ? card.records : card.examples;
  const [shown, setShown] = useState(PAGE);
  if (!card.exceptions) return <p className="muted dq-hint">No exceptions for {card.subject}.</p>;
  if (!rows.length) return <p className="muted dq-hint">No list of rows is kept for this result{card.recordsCapped ? " — every row is affected, so a list would add nothing" : ""}.</p>;
  return (
    <div className="dq-detail">
      <div className="dq-section-head">
        <h4>Exceptions</h4>
        <ExportButton
          label="Export CSV"
          title={complete ? `Download all exceptions of ${card.subject} as CSV` : "Available once the source file is loaded"}
          onClick={() => downloadBlob(recordsCsv(rows, card.subject), `exceptions-${card.testId.replace(/[^a-z0-9]+/gi, "-")}.csv`)}
          disabled={!complete}
        />
      </div>
      <div className="dq-table-wrap">
        <table className="dq-table">
          <thead><tr><th>Row in file</th><th>{card.subject}</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.slice(0, shown).map((r, i) => (
              <tr key={`${r.row}-${i}`}><td>{r.row}</td><td className="dq-mono">{r.value.trim() ? r.value : <em className="muted">blank</em>}</td><td>{r.reason}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted dq-hint">
        Showing {Math.min(shown, rows.length).toLocaleString()} of {card.exceptions.toLocaleString()} exception{card.exceptions === 1 ? "" : "s"}
        {card.recordsCapped ? ` (only the first ${rows.length.toLocaleString()} are kept for viewing and export)` : ""}.
        {rows.length > shown ? <> <button className="dq-link" onClick={() => setShown((s) => s + PAGE)}>Show more</button></> : null}
      </p>
    </div>
  );
}
