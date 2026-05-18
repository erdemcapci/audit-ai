import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";
import type { FieldworkItem, FieldworkState, Finding, FindingsState, PlanningState } from "../types";

type OpenState = Record<string, boolean>;
type BusyState = Record<string, boolean>;

function fieldworkSourceId(item: FieldworkItem): string {
  return item.source_test_id || item.test_id;
}

export function FieldworkScreen({
  planning,
  fieldwork,
  findings,
  onChange,
  onRefineFinding,
  onCreateFinding,
  onSaveFindings,
  onDeleteFinding
}: {
  planning: PlanningState | null;
  fieldwork: FieldworkState;
  findings: FindingsState | null;
  onChange: (fieldwork: FieldworkState) => Promise<void>;
  onRefineFinding: (description: string, itemId: string) => Promise<Finding>;
  onCreateFinding: (finding: Finding) => Promise<void>;
  onSaveFindings: (findings: FindingsState) => Promise<void>;
  onDeleteFinding: (findingId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(fieldwork);
  const [draftFindings, setDraftFindings] = useState<FindingsState>(findings || { findings: [] });
  const [open, setOpen] = useState<OpenState>({});
  const [busy, setBusy] = useState<BusyState>({});
  const [roughTextByItem, setRoughTextByItem] = useState<Record<string, string>>({});
  const [previewByItem, setPreviewByItem] = useState<Record<string, Finding | undefined>>({});
  const [testFilter, setTestFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => setDraft(fieldwork), [fieldwork]);
  useEffect(() => setDraftFindings(findings || { findings: [] }), [findings]);

  const fieldworkByTest = useMemo(() => {
    const map = new Map<string, { item: FieldworkItem; index: number }>();
    draft.items.forEach((item, index) => map.set(fieldworkSourceId(item), { item, index }));
    return map;
  }, [draft]);

  const findingsByFieldwork = useMemo(() => {
    const map = new Map<string, Finding[]>();
    draftFindings.findings.forEach((finding) => {
      if (!finding.linked_fieldwork_item_id) return;
      const current = map.get(finding.linked_fieldwork_item_id) || [];
      current.push(finding);
      map.set(finding.linked_fieldwork_item_id, current);
    });
    return map;
  }, [draftFindings]);

  function toggle(id: string) {
    setOpen((current) => ({ ...current, [id]: !current[id] }));
  }

  function updateItem(index: number, field: "status" | "notes", value: string) {
    const next = structuredClone(draft);
    next.items[index][field] = value;
    setDraft(next);
  }

  function testMatches(test: PlanningState["workstreams"][number]["objectives"][number]["risks"][number]["tests"][number]) {
    const linked = fieldworkByTest.get(test.id);
    const query = testFilter.trim().toLowerCase();
    const matchesText =
      !query ||
      [test.title, test.description, test.test_type, linked?.item.title, linked?.item.description, linked?.item.notes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    const matchesStatus = statusFilter === "All" || linked?.item.status === statusFilter;
    return matchesText && matchesStatus;
  }

  function updateFinding(findingId: string, field: keyof Finding, value: string) {
    setDraftFindings((current) => ({
      findings: current.findings.map((finding) => (finding.id === findingId ? { ...finding, [field]: value, status: "Edited" } : finding))
    }));
  }

  async function refineIssue(item: FieldworkItem) {
    const raw = roughTextByItem[item.id]?.trim();
    if (!raw) return;
    setBusy((current) => ({ ...current, [`preview:${item.id}`]: true }));
    try {
      const refined = await onRefineFinding(raw, item.id);
      setPreviewByItem((current) => ({ ...current, [item.id]: refined }));
    } finally {
      setBusy((current) => ({ ...current, [`preview:${item.id}`]: false }));
    }
  }

  async function createPreview(itemId: string) {
    const preview = previewByItem[itemId];
    if (!preview) return;
    await onCreateFinding(preview);
    setPreviewByItem((current) => ({ ...current, [itemId]: undefined }));
    setRoughTextByItem((current) => ({ ...current, [itemId]: "" }));
  }

  async function regenerateFinding(finding: Finding) {
    const raw = finding.raw_description || finding.issue || finding.title;
    if (!finding.linked_fieldwork_item_id || !raw.trim()) return;
    setBusy((current) => ({ ...current, [`finding:${finding.id}`]: true }));
    try {
      const regenerated = await onRefineFinding(raw, finding.linked_fieldwork_item_id);
      setDraftFindings((current) => ({
        findings: current.findings.map((item) =>
          item.id === finding.id
            ? {
                ...regenerated,
                id: finding.id,
                linked_fieldwork_item_id: finding.linked_fieldwork_item_id,
                raw_description: raw,
                status: "Edited"
              }
            : item
        )
      }));
    } finally {
      setBusy((current) => ({ ...current, [`finding:${finding.id}`]: false }));
    }
  }

  async function regenerateFindingPart(finding: Finding, part: "issue" | "recommendation") {
    const raw = finding.raw_description || finding.issue || finding.title;
    if (!finding.linked_fieldwork_item_id || !raw.trim()) return;
    const busyKey = `${part}:${finding.id}`;
    setBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const regenerated = await onRefineFinding(raw, finding.linked_fieldwork_item_id);
      setDraftFindings((current) => ({
        findings: current.findings.map((item) =>
          item.id === finding.id
            ? {
                ...item,
                title: part === "issue" ? regenerated.title : item.title,
                issue: part === "issue" ? regenerated.issue : item.issue,
                recommendation: part === "recommendation" ? regenerated.recommendation : item.recommendation,
                management_action: part === "recommendation" ? regenerated.management_action : item.management_action,
                status: "Edited"
              }
            : item
        )
      }));
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function deleteFinding(findingId: string) {
    await onDeleteFinding(findingId);
    setDraftFindings((current) => ({ findings: current.findings.filter((finding) => finding.id !== findingId) }));
  }

  function renderPreview(item: FieldworkItem) {
    const preview = previewByItem[item.id];
    if (!preview) return null;
    return (
      <div className="issue-preview">
        <div className="planning-subhead">
          <strong>Refined issue and recommendation</strong>
          <span>Draft</span>
        </div>
        <TextInput label="Title" value={preview.title} onChange={(event) => setPreviewByItem((current) => ({ ...current, [item.id]: { ...preview, title: event.target.value } }))} />
        <TextArea label="Issue" rows={3} value={preview.issue} onChange={(event) => setPreviewByItem((current) => ({ ...current, [item.id]: { ...preview, issue: event.target.value } }))} />
        <TextArea label="Recommendation" rows={3} value={preview.recommendation} onChange={(event) => setPreviewByItem((current) => ({ ...current, [item.id]: { ...preview, recommendation: event.target.value } }))} />
        <Select label="Severity" value={preview.severity} onChange={(event) => setPreviewByItem((current) => ({ ...current, [item.id]: { ...preview, severity: event.target.value } }))}>
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
        </Select>
        <div className="button-row">
          <Button variant="ghost" onClick={() => refineIssue(item)} disabled={busy[`preview:${item.id}`]}>Try Again</Button>
          <Button onClick={() => createPreview(item.id)}>Create Issue</Button>
        </div>
      </div>
    );
  }

  function renderFinding(finding: Finding) {
    return (
      <div className="issue-editor" key={finding.id}>
        <TextInput label="Issue title" value={finding.title} onChange={(event) => updateFinding(finding.id, "title", event.target.value)} />
        <TextArea label="Issue" rows={3} value={finding.issue} onChange={(event) => updateFinding(finding.id, "issue", event.target.value)} />
        <TextArea label="Recommendation" rows={3} value={finding.recommendation} onChange={(event) => updateFinding(finding.id, "recommendation", event.target.value)} />
        <Select label="Severity" value={finding.severity} onChange={(event) => updateFinding(finding.id, "severity", event.target.value)}>
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
        </Select>
        <div className="button-row">
          <Button variant="ghost" onClick={() => regenerateFindingPart(finding, "issue")} disabled={busy[`issue:${finding.id}`]}>
            {busy[`issue:${finding.id}`] ? "Regenerating issue" : "Regenerate Issue"}
          </Button>
          <Button variant="ghost" onClick={() => regenerateFindingPart(finding, "recommendation")} disabled={busy[`recommendation:${finding.id}`]}>
            {busy[`recommendation:${finding.id}`] ? "Regenerating recommendation" : "Regenerate Recommendation"}
          </Button>
          <Button variant="ghost" onClick={() => regenerateFinding(finding)} disabled={busy[`finding:${finding.id}`]}>
            {busy[`finding:${finding.id}`] ? "Regenerating" : "Regenerate"}
          </Button>
          <Button variant="danger" onClick={() => deleteFinding(finding.id)}>Delete</Button>
        </div>
      </div>
    );
  }

  function renderFieldworkItem(item: FieldworkItem, index: number) {
    const itemFindings = findingsByFieldwork.get(item.id) || [];
    return (
      <div className="fieldwork-execution-card">
        <div className="fieldwork-card-header">
          <div>
            <h4>{item.title}</h4>
            <p>{item.description}</p>
          </div>
          <Select label="Status" value={item.status} onChange={(event) => updateItem(index, "status", event.target.value)}>
            <option>Not Started</option>
            <option>In Progress</option>
            <option>Completed</option>
            <option>Issue Identified</option>
          </Select>
        </div>
        <p className="evidence-line">Expected evidence: {item.expected_evidence}</p>
        <TextArea label="Fieldwork notes" value={item.notes} rows={3} onChange={(event) => updateItem(index, "notes", event.target.value)} />
        <div className="fieldwork-issues">
          <div className="planning-subhead">
            <strong>Issues and recommendations for this test</strong>
            <span>{itemFindings.length} issue{itemFindings.length === 1 ? "" : "s"}</span>
          </div>
          {itemFindings.map(renderFinding)}
          <div className="finding-inline">
            <TextArea
              label="Rough issue from this test"
              rows={2}
              value={roughTextByItem[item.id] || ""}
              onChange={(event) => setRoughTextByItem({ ...roughTextByItem, [item.id]: event.target.value })}
            />
            <Button
              variant="secondary"
              onClick={() => refineIssue(item)}
              disabled={!roughTextByItem[item.id]?.trim() || busy[`preview:${item.id}`]}
            >
              {busy[`preview:${item.id}`] ? "Refining" : "Refine"}
            </Button>
          </div>
          {renderPreview(item)}
        </div>
      </div>
    );
  }

  return (
    <section className="screen-panel">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Fieldwork</p>
          <h2>Fieldwork hierarchy</h2>
        </div>
        <div className="button-row">
          <Button onClick={() => onChange(draft)}>Save Fieldwork</Button>
          <Button variant="secondary" onClick={() => onSaveFindings(draftFindings)}>Save Issues</Button>
        </div>
      </header>
      {!planning?.workstreams.length ? <p className="muted">Approve planning and create fieldwork items to see the hierarchy.</p> : null}
      <div className="fieldwork-filter-bar">
        <TextInput
          label="Filter tests"
          value={testFilter}
          onChange={(event) => setTestFilter(event.target.value)}
          placeholder="Search test title, type, notes, or description"
        />
        <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option>All</option>
          <option>Not Started</option>
          <option>In Progress</option>
          <option>Completed</option>
          <option>Issue Identified</option>
        </Select>
        <Button variant="ghost" onClick={() => {
          setTestFilter("");
          setStatusFilter("All");
        }}>Clear Filters</Button>
      </div>
      <div className="fieldwork-hierarchy">
        {planning?.workstreams.map((workstream) => {
          const visibleObjectives = workstream.objectives
            .map((objective) => ({
              ...objective,
              risks: objective.risks
                .map((risk) => ({ ...risk, tests: risk.tests.filter(testMatches) }))
                .filter((risk) => risk.tests.length)
            }))
            .filter((objective) => objective.risks.length);
          if (!visibleObjectives.length) return null;
          return (
            <Card key={workstream.id}>
              <button className="planning-expand-row hierarchy-row" type="button" onClick={() => toggle(workstream.id)}>
                <span>{open[workstream.id] ? "−" : "+"}</span>
                <strong>{workstream.name}</strong>
                <em>{visibleObjectives.length} objective{visibleObjectives.length === 1 ? "" : "s"}</em>
              </button>
              {open[workstream.id] ? (
                <div className="hierarchy-children">
                  {visibleObjectives.map((objective) => (
                    <div className="hierarchy-level" key={objective.id}>
                      <button className="planning-expand-row hierarchy-row" type="button" onClick={() => toggle(objective.id)}>
                        <span>{open[objective.id] ? "−" : "+"}</span>
                        <strong>{objective.title}</strong>
                        <em>{objective.risks.length} risk{objective.risks.length === 1 ? "" : "s"}</em>
                      </button>
                      {open[objective.id] ? (
                        <div className="hierarchy-children">
                          {objective.risks.map((risk) => (
                            <div className="hierarchy-level" key={risk.id}>
                              <button className="planning-expand-row hierarchy-row" type="button" onClick={() => toggle(risk.id)}>
                                <span>{open[risk.id] ? "−" : "+"}</span>
                                <strong>{risk.title}</strong>
                                <em>{risk.tests.length} test{risk.tests.length === 1 ? "" : "s"}</em>
                              </button>
                              {open[risk.id] ? (
                                <div className="hierarchy-children">
                                  {risk.tests.map((test) => {
                                    const linked = fieldworkByTest.get(test.id);
                                    return (
                                      <div className="hierarchy-level" key={test.id}>
                                        <button className="planning-expand-row hierarchy-row test-row" type="button" onClick={() => toggle(test.id)}>
                                          <span>{open[test.id] ? "−" : "+"}</span>
                                          <strong>{test.title}</strong>
                                          <em>{linked?.item.status || "No fieldwork item"}</em>
                                        </button>
                                        {open[test.id] ? (
                                          linked ? renderFieldworkItem(linked.item, linked.index) : <p className="muted">No fieldwork item has been created for this test yet.</p>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
