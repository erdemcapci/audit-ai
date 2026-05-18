import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { TextArea } from "../components/TextArea";
import type { InterviewPlan } from "../types";

export function InterviewsScreen({
  plan,
  onGenerate,
  onChange,
  agentExecutionEnabled = true
}: {
  plan: InterviewPlan;
  onGenerate: () => Promise<void>;
  onChange: (plan: InterviewPlan) => Promise<void>;
  agentExecutionEnabled?: boolean;
}) {
  const [draft, setDraft] = useState(plan);

  useEffect(() => setDraft(plan), [plan]);

  function updateNotes(roleIndex: number, value: string) {
    const next = structuredClone(draft);
    next.roles[roleIndex].notes = value;
    next.roles[roleIndex].status = "Edited";
    setDraft(next);
  }

  return (
    <section className="screen-panel">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Interviews</p>
          <h2>Interview plan</h2>
        </div>
        <div className="button-row">
          <Button onClick={onGenerate} disabled={!agentExecutionEnabled}>Generate Interview Plan</Button>
          <Button variant="secondary" onClick={() => onChange(draft)} disabled={!draft.roles.length}>Save Notes</Button>
        </div>
      </header>
      {!draft.roles.length ? <EmptyState title="No interview plan yet" description="Generate role-based questions from the current planning hierarchy." /> : null}
      <div className="role-grid">
        {draft.roles.map((role, roleIndex) => (
          <Card key={role.id}>
            <h3>{role.role_title}</h3>
            <p>{role.expected_information}</p>
            <ul className="question-list">
              {role.questions.map((question) => (
                <li key={question.id}>{question.question_text}</li>
              ))}
            </ul>
            <TextArea
              label="Notes from this interview"
              rows={5}
              value={role.notes || ""}
              onChange={(event) => updateNotes(roleIndex, event.target.value)}
            />
          </Card>
        ))}
      </div>
    </section>
  );
}
