import { useMemo, useState, type FormEvent } from "react";
import type { Dataset } from "./engine/csv";
import { downloadBlob } from "./engine/source";
import type { FullState } from "./TestResultScreen";
import { ExportButton } from "./FindingDetail";

const PAGE = 100;

/** The stored source file as a searchable table, with the original download. */
export function SourceFileView({ fileName, data, bytes, state, stored }: { fileName: string; data: Dataset | null; bytes: ArrayBuffer | null; state: FullState; stored: boolean }) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const matches = useMemo(() => {
    if (!data) return [];
    const indexes = data.rows.map((_, i) => i);
    if (!query) return indexes;
    const needle = query.toLowerCase();
    return indexes.filter((i) => data.rows[i].some((cell) => cell.toLowerCase().includes(needle)));
  }, [data, query]);

  if (!stored) return <div className="dq-empty"><strong>The source file of this run was deleted</strong><span>The results are kept, but the original data can no longer be shown.</span></div>;
  if (state === "loading" || (!data && state !== "error")) return <div className="dq-empty"><strong>Loading the source file…</strong></div>;
  if (!data) return <div className="error-banner">The source file could not be loaded.</div>;

  const pages = Math.max(1, Math.ceil(matches.length / PAGE));
  const current = Math.min(page, pages - 1);
  const search = (event: FormEvent) => { event.preventDefault(); setQuery(draft.trim()); setPage(0); };

  return (
    <div className="dq-detail">
      <div className="dq-section-head">
        <form className="dq-search" onSubmit={search}>
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search all values" aria-label="Search the file" />
          <button className="dq-btn" type="submit">Search</button>
          {query ? <button className="dq-btn" type="button" onClick={() => { setDraft(""); setQuery(""); setPage(0); }}>Clear</button> : null}
        </form>
        <ExportButton label="Download original" title={`Download ${fileName} exactly as it was loaded`} onClick={() => bytes && downloadBlob(new Blob([bytes], { type: "text/csv" }), fileName)} disabled={!bytes} />
      </div>
      <p className="muted dq-hint">{query ? `${matches.length.toLocaleString()} rows contain “${query}”.` : `${data.rows.length.toLocaleString()} rows, ${data.headers.length} columns.`} Row numbers match the file, where row 1 is the header.</p>
      <div className="dq-table-wrap dq-file-table">
        <table className="dq-table">
          <thead><tr><th>Row</th>{data.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {matches.slice(current * PAGE, current * PAGE + PAGE).map((i) => (
              <tr key={i}><td className="muted">{i + 2}</td>{data.rows[i].map((cell, c) => <td key={c}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="dq-pager">
          <button className="dq-btn" onClick={() => setPage(current - 1)} disabled={current === 0}>Previous</button>
          <span>Page {current + 1} of {pages.toLocaleString()}</span>
          <button className="dq-btn" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>Next</button>
        </div>
      ) : null}
    </div>
  );
}
