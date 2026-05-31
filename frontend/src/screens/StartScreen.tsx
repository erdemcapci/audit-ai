import { FormEvent, useEffect, useState } from "react";
import { projectsApi } from "../api/projectsApi";
import type { UserMe } from "../api/authApi";
import type { RuntimeSettings } from "../api/settingsApi";
import { Button } from "../components/Button";
import { BrandingFooter } from "../components/BrandingFooter";
import { Card } from "../components/Card";
import { LoadingState } from "../components/LoadingState";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";
import type { AuditProject } from "../types";

export function StartScreen({
  onStart,
  onOpenExisting,
  runtime,
  user,
  onLogoutUser,
  onSignIn,
  onHowToUse
}: {
  onStart: (payload: {
    title: string;
    description: string;
    process_area: string;
    initial_concern: string;
    extra_context: string;
    accepted_data_warning?: boolean;
  }) => Promise<void>;
  onOpenExisting: (projectId: string) => void;
  runtime: RuntimeSettings | null;
  user: UserMe | null;
  onLogoutUser: () => Promise<void>;
  onSignIn: () => void;
  onHowToUse: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [processArea, setProcessArea] = useState("");
  const [initialConcern, setInitialConcern] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [acceptedDataWarning, setAcceptedDataWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<AuditProject[]>([]);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (runtime?.deploymentMode === "hosted" && !acceptedDataWarning) {
      setError("Confirm that you will not enter confidential or sensitive data.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onStart({
        title,
        description,
        process_area: processArea,
        initial_concern: initialConcern,
        extra_context: extraContext,
        accepted_data_warning: runtime?.deploymentMode === "hosted" ? acceptedDataWarning : undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create audit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="start-screen">
      <header className="start-session-bar">
        <div />
        <div className="header-actions">
          {runtime?.isAdmin ? <span className="session-pill session-pill-admin">Logged in as admin</span> : null}
          {user?.isAuthenticated ? <span className="session-pill">{user.username}</span> : null}
          <Button variant="ghost" onClick={onHowToUse}>How to use</Button>
          {runtime?.deploymentMode === "hosted" && !user?.isAuthenticated ? <Button variant="ghost" onClick={onSignIn}>Sign in</Button> : null}
          {user?.isAuthenticated ? <Button variant="ghost" onClick={onLogoutUser}>Sign out</Button> : null}
          {runtime?.isAdmin ? <Button variant="ghost" onClick={() => { window.location.href = "/admin"; }}>Admin</Button> : null}
        </div>
      </header>
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
            {runtime?.deploymentMode === "hosted" ? (
              <label className="checkbox-row warning-checkbox">
                <input
                  type="checkbox"
                  checked={acceptedDataWarning}
                  onChange={(event) => setAcceptedDataWarning(event.target.checked)}
                />
                <span>
                  This hosted demo is for evaluation only. Do not enter confidential, personal, client, financial, audit, or sensitive company data.
                  <strong> I understand and will not enter confidential or sensitive data.</strong>
                </span>
              </label>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={busy || !title.trim() || !description.trim() || (runtime?.deploymentMode === "hosted" && !acceptedDataWarning)}>
              {busy ? "Creating audit workspace" : "Create audit workspace"}
            </Button>
            {busy ? <LoadingState label={runtime?.deploymentMode === "hosted" ? "Creating demo audit" : "Creating local project files"} /> : null}
          </form>
        </Card>
      </section>
      {projects.length ? (
        <section className="recent-projects">
          <h2>{runtime?.deploymentMode === "hosted" ? "Available audits" : "Recent local audits"}</h2>
          <div className="recent-grid">
            {projects.map((project) => (
              <button key={project.id} className="recent-card" onClick={() => onOpenExisting(project.id)}>
                <strong>{project.title}</strong>
                {project.visibility === "public_sample" ? <em>Public sample</em> : null}
                {project.visibility === "anonymous_temp" ? <em>Temporary demo audit</em> : null}
                {project.visibility === "private" ? <em>Private audit</em> : null}
                <span>{project.description}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <BrandingFooter />
    </main>
  );
}
