import { FormEvent, useEffect, useState } from "react";
import { projectsApi } from "../api/projectsApi";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { LoadingState } from "../components/LoadingState";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";
import type { AuditProject } from "../types";

export function StartScreen({
  onStart,
  onOpenExisting
}: {
  onStart: (payload: { title: string; description: string; process_area: string; initial_concern: string; extra_context: string }) => Promise<void>;
  onOpenExisting: (projectId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [processArea, setProcessArea] = useState("");
  const [initialConcern, setInitialConcern] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<AuditProject[]>([]);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onStart({ title, description, process_area: processArea, initial_concern: initialConcern, extra_context: extraContext });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create audit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="start-screen">
      <section className="start-hero">
        <div>
          <h1>Start a new audit</h1>
          <p className="hero-copy">
            Create a local audit workspace, then generate objectives, risks, and tests when you are ready.
          </p>
        </div>
        <Card className="start-card">
          <form onSubmit={submit}>
            <TextInput label="Audit Title" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Procurement audit" />
            <TextArea
              label="Audit Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
              rows={5}
              placeholder="Review procurement controls from vendor onboarding through invoice approval."
            />
            <button type="button" className="optional-toggle" onClick={() => setShowOptional((value) => !value)}>
              {showOptional ? "Hide optional context" : "Add optional context"}
            </button>
            {showOptional ? (
              <div className="optional-fields">
                <TextInput label="Business / Process Area" value={processArea} onChange={(event) => setProcessArea(event.target.value)} />
                <TextInput label="Initial Concern" value={initialConcern} onChange={(event) => setInitialConcern(event.target.value)} />
                <TextArea label="Extra Context" value={extraContext} onChange={(event) => setExtraContext(event.target.value)} rows={3} />
              </div>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={busy || !title.trim() || !description.trim()}>
              {busy ? "Creating audit workspace" : "Create audit workspace"}
            </Button>
            {busy ? <LoadingState label="Creating local project files" /> : null}
          </form>
        </Card>
      </section>
      {projects.length ? (
        <section className="recent-projects">
          <h2>Recent local audits</h2>
          <div className="recent-grid">
            {projects.map((project) => (
              <button key={project.id} className="recent-card" onClick={() => onOpenExisting(project.id)}>
                <strong>{project.title}</strong>
                <span>{project.description}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
