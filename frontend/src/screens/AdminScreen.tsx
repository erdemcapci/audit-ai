import { useEffect, useState } from "react";
import { adminApi, type AdminMe, type DemoJobStatus } from "../api/adminApi";
import type { RuntimeSettings } from "../api/settingsApi";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";

export function AdminScreen({
  onOpenProject,
  onRuntimeChange,
  refreshRuntime
}: {
  onOpenProject: (projectId: string) => void;
  onRuntimeChange: (runtime: RuntimeSettings) => void;
  refreshRuntime: () => Promise<RuntimeSettings>;
}) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [secret, setSecret] = useState("");
  const [title, setTitle] = useState("Procurement Process Audit");
  const [description, setDescription] = useState("Review procurement governance, vendor onboarding, purchase approvals, invoice matching, and segregation of duties.");
  const [processArea, setProcessArea] = useState("Procurement");
  const [initialConcern, setInitialConcern] = useState("Potential inconsistent approval evidence and vendor due diligence.");
  const [runFullDemo, setRunFullDemo] = useState(true);
  const [job, setJob] = useState<DemoJobStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.me().then((next) => {
      setMe(next);
      onRuntimeChange(next.runtime);
    }).catch((err) => setMessage(err instanceof Error ? err.message : "Unable to load admin status."));
  }, [onRuntimeChange]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const interval = window.setInterval(async () => {
      const next = await adminApi.getJob(job.jobId);
      setJob(next);
      if (next.status !== "running") {
        window.clearInterval(interval);
        const runtime = await refreshRuntime();
        onRuntimeChange(runtime);
      }
    }, 1200);
    return () => window.clearInterval(interval);
  }, [job, onRuntimeChange, refreshRuntime]);

  async function login() {
    setBusy(true);
    setMessage("");
    try {
      const next = await adminApi.login(secret);
      setMe(next);
      onRuntimeChange(next.runtime);
      setSecret("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const next = await adminApi.logout();
    setMe(next);
    onRuntimeChange(next.runtime);
  }

  async function createDemo() {
    setBusy(true);
    setMessage("");
    try {
      const next = await adminApi.createDemo({ title, description, processArea, initialConcern, runFullDemo });
      setJob(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to create demo audit.");
    } finally {
      setBusy(false);
    }
  }

  const runtime = me?.runtime;
  const isAdmin = Boolean(me?.isAdmin);

  return (
    <main className="workspace admin-workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>AuditCopilot Showcase Admin</h1>
          <p>Create hosted demo audits and run the full audit generation pipeline.</p>
        </div>
        <div className="header-actions">
          {isAdmin ? <Button variant="ghost" onClick={logout}>Logout</Button> : null}
          <Button variant="ghost" onClick={() => { window.location.href = "/"; }}>Back to app</Button>
        </div>
      </header>

      {message ? <div className="error-banner">{message}</div> : null}

      {!isAdmin ? (
        <Card className="admin-card">
          <h2>Admin login</h2>
          <p className="muted">Enter the configured admin secret to enable hosted AI generation.</p>
          <TextInput label="Admin secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
          <Button onClick={login} disabled={busy || !secret.trim()}>Login</Button>
        </Card>
      ) : (
        <div className="admin-grid">
          <Card className="admin-card">
            <h2>Runtime status</h2>
            <dl className="runtime-list">
              <dt>Deployment mode</dt>
              <dd>{runtime?.deploymentMode}</dd>
              <dt>Admin enabled</dt>
              <dd>{runtime?.adminEnabled ? "Yes" : "No"}</dd>
              <dt>Provider configured</dt>
              <dd>{runtime?.llmProviderConfigured ? "Yes" : "No"}</dd>
              <dt>AI execution</dt>
              <dd>{runtime?.agentExecutionEnabled ? "Enabled" : "Disabled"}</dd>
            </dl>
          </Card>

          <Card className="admin-card">
            <h2>Create demo audit</h2>
            <TextInput label="Audit title" value={title} onChange={(event) => setTitle(event.target.value)} />
            <TextArea label="Audit description" rows={5} value={description} onChange={(event) => setDescription(event.target.value)} />
            <TextInput label="Business / process area" value={processArea} onChange={(event) => setProcessArea(event.target.value)} />
            <TextInput label="Initial concern" value={initialConcern} onChange={(event) => setInitialConcern(event.target.value)} />
            <label className="check-row">
              <input type="checkbox" checked={runFullDemo} onChange={(event) => setRunFullDemo(event.target.checked)} />
              <span>Run full end-to-end demo</span>
            </label>
            <Button onClick={createDemo} disabled={busy || !title.trim() || !description.trim() || runtime?.agentExecutionEnabled === false}>
              Create Demo Audit
            </Button>
          </Card>

          {job ? (
            <Card className="admin-card admin-job-card">
              <h2>Demo generation</h2>
              <p className="muted">{job.status === "running" ? job.currentStep : job.status}</p>
              <div className="admin-step-list">
                {job.steps.map((step) => (
                  <div key={step.name} className={`admin-step admin-step-${step.status}`}>
                    <span>{step.status === "completed" ? "✓" : step.status === "running" ? "●" : step.status === "failed" ? "!" : "○"}</span>
                    <strong>{step.name}</strong>
                  </div>
                ))}
              </div>
              {job.error ? <div className="error-banner">{job.error}</div> : null}
              {job.projectId ? <Button onClick={() => onOpenProject(job.projectId || "")}>Open generated audit</Button> : null}
            </Card>
          ) : null}
        </div>
      )}
    </main>
  );
}
