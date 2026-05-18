import { useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";
import type { PlanningState } from "../types";

function planningHasTests(planning: PlanningState): boolean {
  return planning.workstreams.some((workstream) =>
    workstream.objectives.some((objective) => objective.risks.some((risk) => risk.tests.length > 0))
  );
}

export function PlanningScreen({
  planning,
  onChange,
  onApprove,
  onReopen
}: {
  planning: PlanningState;
  onChange: (planning: PlanningState) => Promise<void>;
  onApprove: () => void | Promise<void>;
  onReopen: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(planning);
  const [expandedRisks, setExpandedRisks] = useState<Record<string, boolean>>({});
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>({});
  const hasTests = planningHasTests(draft);

  function updateObjective(workstreamIndex: number, objectiveIndex: number, field: "title" | "description", value: string) {
    const next = structuredClone(draft);
    next.workstreams[workstreamIndex].objectives[objectiveIndex][field] = value;
    next.workstreams[workstreamIndex].objectives[objectiveIndex].status = "Edited";
    setDraft(next);
  }

  function toggleRisk(riskId: string) {
    setExpandedRisks((current) => ({ ...current, [riskId]: !current[riskId] }));
  }

  function toggleTest(testId: string) {
    setExpandedTests((current) => ({ ...current, [testId]: !current[testId] }));
  }

  function updateRisk(
    workstreamIndex: number,
    objectiveIndex: number,
    riskIndex: number,
    field: "title" | "description" | "why_it_matters" | "potential_impact" | "severity",
    value: string
  ) {
    const next = structuredClone(draft);
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex][field] = value;
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex].status = "Edited";
    setDraft(next);
  }

  function updateTest(
    workstreamIndex: number,
    objectiveIndex: number,
    riskIndex: number,
    testIndex: number,
    field: "title" | "test_type" | "test_objective" | "description" | "expected_evidence" | "sample_considerations",
    value: string
  ) {
    const next = structuredClone(draft);
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex].tests[testIndex][field] = value;
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex].tests[testIndex].status = "Edited";
    setDraft(next);
  }

  return (
    <section className="screen-panel">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Planning</p>
          <h2>Workstreams, objectives, risks, and tests</h2>
        </div>
        <div className="button-row">
          <Button onClick={() => onChange(draft)}>Save Planning Edits</Button>
          {draft.approved ? (
            <Button variant="secondary" onClick={onReopen}>Reopen Planning</Button>
          ) : (
            <Button variant="secondary" onClick={onApprove} disabled={!hasTests}>Approve Planning</Button>
          )}
        </div>
      </header>
      {draft.approved ? <p className="muted">Planning is approved. Reopen it if you need to make planning changes before continuing.</p> : null}
      {!hasTests ? <p className="muted">Generate tests before approving planning.</p> : null}
      <div className="planning-list">
        {draft.workstreams.map((workstream, workstreamIndex) => (
          <Card key={workstream.id}>
            <h3>{workstream.name}</h3>
            <p>{workstream.rationale}</p>
            {workstream.objectives.map((objective, objectiveIndex) => (
              <div className="editable-object" key={objective.id}>
                <TextInput
                  label="Objective title"
                  value={objective.title}
                  onChange={(event) => updateObjective(workstreamIndex, objectiveIndex, "title", event.target.value)}
                />
                <TextArea
                  label="Objective description"
                  value={objective.description}
                  onChange={(event) => updateObjective(workstreamIndex, objectiveIndex, "description", event.target.value)}
                  rows={3}
                />
                <div className="planning-subhead planning-section-header">
                  <strong>Risks</strong>
                  <span>{objective.risks.length} risk{objective.risks.length === 1 ? "" : "s"}</span>
                </div>
                <div className="mini-grid">
                  {objective.risks.map((risk, riskIndex) => (
                    <div className="mini-card planning-risk-card" key={risk.id}>
                      <button className="planning-expand-row" type="button" onClick={() => toggleRisk(risk.id)}>
                        <span>{expandedRisks[risk.id] ? "−" : "+"}</span>
                        <strong>{risk.title}</strong>
                        <em>{risk.severity || "No severity"}</em>
                      </button>
                      {expandedRisks[risk.id] ? (
                        <div className="planning-expanded-fields">
                          <TextInput
                            label="Risk title"
                            value={risk.title}
                            onChange={(event) => updateRisk(workstreamIndex, objectiveIndex, riskIndex, "title", event.target.value)}
                          />
                          <TextInput
                            label="Risk severity"
                            value={risk.severity}
                            onChange={(event) => updateRisk(workstreamIndex, objectiveIndex, riskIndex, "severity", event.target.value)}
                          />
                          <TextArea
                            label="Risk description"
                            value={risk.description}
                            onChange={(event) => updateRisk(workstreamIndex, objectiveIndex, riskIndex, "description", event.target.value)}
                            rows={3}
                          />
                        </div>
                      ) : null}
                      <div className="planning-tests">
                        <div className="planning-subhead">
                          <strong>Tests</strong>
                          <span>{risk.tests.length} test{risk.tests.length === 1 ? "" : "s"}</span>
                        </div>
                        {risk.tests.length ? (
                          risk.tests.map((test, testIndex) => (
                            <div className="planning-test-card" key={test.id}>
                              <button className="planning-expand-row test-row" type="button" onClick={() => toggleTest(test.id)}>
                                <span>{expandedTests[test.id] ? "−" : "+"}</span>
                                <strong>{test.title}</strong>
                                <em>{test.test_type || "No type"}</em>
                              </button>
                              {expandedTests[test.id] ? (
                                <div className="planning-expanded-fields">
                                  <TextInput
                                    label="Test title"
                                    value={test.title}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "title", event.target.value)}
                                  />
                                  <Select
                                    label="Test type"
                                    value={test.test_type}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "test_type", event.target.value)}
                                  >
                                    <option value="Test of Design">Test of Design</option>
                                    <option value="Test of Operating Effectiveness">Test of Operating Effectiveness</option>
                                    <option value="Detailed Test">Detailed Test</option>
                                    <option value="Analytical Review">Analytical Review</option>
                                    <option value="Inquiry / Interview">Inquiry / Interview</option>
                                  </Select>
                                  <TextArea
                                    label="Test objective"
                                    value={test.test_objective}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "test_objective", event.target.value)}
                                    rows={2}
                                  />
                                  <TextArea
                                    label="Description"
                                    value={test.description}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "description", event.target.value)}
                                    rows={3}
                                  />
                                  <TextArea
                                    label="Expected evidence"
                                    value={test.expected_evidence}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "expected_evidence", event.target.value)}
                                    rows={2}
                                  />
                                  <TextArea
                                    label="Sample considerations"
                                    value={test.sample_considerations}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "sample_considerations", event.target.value)}
                                    rows={2}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="muted">No tests generated for this risk yet.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </section>
  );
}
