import { useEffect, useState } from "react";
import { adminApi, type AdminMe, type AdminUserSummary, type DemoJobStatus } from "../api/adminApi";
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
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.me().then((next) => {
      setMe(next);
      onRuntimeChange(next.runtime);
      if (next.isAdmin) {
        adminApi.users().then(setUsers).catch(() => setUsers([]));
      }
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
      setUsers(await adminApi.users());
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
    setUsers([]);
    onRuntimeChange(next.runtime);
  }

  async function updateUserAccess(user: AdminUserSummary, changes: Partial<Pick<AdminUserSummary, "canRunAgents" | "aiTotalRunLimit" | "aiRunsUsed" | "aiModel">>) {
    setBusy(true);
    setMessage("");
    try {
      const updated = await adminApi.updateUserAccess(user.id, {
        canRunAgents: changes.canRunAgents ?? user.canRunAgents,
        aiTotalRunLimit: changes.aiTotalRunLimit ?? user.aiTotalRunLimit,
        aiRunsUsed: changes.aiRunsUsed ?? user.aiRunsUsed,
        aiModel: changes.aiModel ?? user.aiModel
      });
      setUsers((current) => current.map((item) => (item.id === user.id ? updated : item)));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to update user access.");
    } finally {
      setBusy(false);
    }
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
  const allowedAiModels = runtime?.allowedAiModels?.length ? runtime.allowedAiModels : [];

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
            <div className="admin-session-pill">Logged in as admin</div>
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
            <h2>User access</h2>
            <p className="muted">Grant AI access, set one total run limit, reset usage, or revoke access.</p>
            {users.length ? (
              <div className="admin-user-list">
                {users.map((user) => (
                  <div key={user.id} className="admin-user-row">
                    <span>
                      <strong>{user.email}</strong>
                      <small>
                        {user.canRunAgents ? `${user.aiRunsRemaining} of ${user.aiTotalRunLimit} AI runs remaining` : "AI access not enabled"}
                      </small>
                    </span>
                    <div className="admin-user-actions">
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={user.canRunAgents}
                          disabled={busy}
                          onChange={(event) => updateUserAccess(user, { canRunAgents: event.target.checked })}
                        />
                        <span>AI access</span>
                      </label>
                      <TextInput
                        label="Total run limit"
                        type="number"
                        value={String(user.aiTotalRunLimit)}
                        onChange={(event) => {
                          const value = Math.max(0, Number(event.target.value || 0));
                          setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, aiTotalRunLimit: value } : item)));
                        }}
                        onBlur={(event) => updateUserAccess(user, { aiTotalRunLimit: Math.max(0, Number(event.target.value || 0)) })}
                      />
                      {allowedAiModels.length ? (
                        <label className="field">
                          <span>AI model</span>
                          <select
                            value={user.aiModel || allowedAiModels[0]}
                            disabled={busy}
                            onChange={(event) => updateUserAccess(user, { aiModel: event.target.value })}
                          >
                            {allowedAiModels.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <small>{user.aiRunsUsed} used</small>
                      <Button variant="ghost" onClick={() => updateUserAccess(user, { aiRunsUsed: 0 })} disabled={busy}>
                        Reset used
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No users have signed up yet.</p>
            )}
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
            <Button onClick={createDemo} disabled={busy || !title.trim() || !description.trim()}>
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
