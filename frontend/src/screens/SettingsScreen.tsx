import { useEffect, useState } from "react";
import { projectsApi } from "../api/projectsApi";
import { settingsApi, type LlmSettings } from "../api/settingsApi";
import { CreatorLink, FeedbackLink } from "../components/BrandingFooter";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { TextInput } from "../components/TextInput";

export function SettingsScreen({
  projectId,
  projectTitle,
  onDeleted,
  onRuntimeChanged
}: {
  projectId: string;
  projectTitle: string;
  onDeleted: () => void;
  onRuntimeChanged?: () => Promise<unknown>;
}) {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    settingsApi.get().then(setSettings).catch((err) => setMessage(err instanceof Error ? err.message : "Unable to load settings."));
  }, []);

  async function save() {
    if (!settings) return;
    const next = await settingsApi.update({
      provider: settings.provider,
      model: settings.model,
      demo_mode: settings.demo_mode,
      ...(openaiApiKey ? { openai_api_key: openaiApiKey } : {}),
      ...(anthropicApiKey ? { anthropic_api_key: anthropicApiKey } : {})
    });
    setSettings(next);
    setOpenaiApiKey("");
    setAnthropicApiKey("");
    setMessage("Settings updated for this backend session.");
    await onRuntimeChanged?.();
  }

  async function test() {
    const result = await settingsApi.test();
    setMessage(result.message);
    await onRuntimeChanged?.();
  }

  async function deleteAudit() {
    if (deleteConfirmText !== "DELETE") return;
    setDeleting(true);
    setMessage("");
    try {
      await projectsApi.delete(projectId);
      onDeleted();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to delete audit.");
    } finally {
      setDeleting(false);
    }
  }

  if (!settings) return null;
  const activeProviderLabel = settings.demo_mode
    ? "Demo mode"
    : settings.provider === "openai"
      ? "OpenAI"
      : settings.provider === "claude"
        ? "Claude"
        : "Ollama";
  const activeModelLabel = settings.demo_mode ? "Demo data" : settings.model;

  return (
    <section className="screen-panel">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>LLM provider</h2>
        </div>
      </header>
      <Card className="settings-card">
        <Select label="Provider" value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value })}>
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI</option>
          <option value="claude">Claude</option>
        </Select>
        <TextInput label="Model" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} />
        {settings.provider === "openai" ? (
          <TextInput
            label="OpenAI API key"
            type="password"
            value={openaiApiKey}
            placeholder={settings.openai_configured ? "OpenAI key is configured. Enter a new key to replace it." : "sk-..."}
            onChange={(event) => setOpenaiApiKey(event.target.value)}
          />
        ) : null}
        {settings.provider === "claude" ? (
          <TextInput
            label="Claude API key"
            type="password"
            value={anthropicApiKey}
            placeholder={settings.anthropic_configured ? "Claude key is configured. Enter a new key to replace it." : "sk-ant-..."}
            onChange={(event) => setAnthropicApiKey(event.target.value)}
          />
        ) : null}
        <label className="check-row">
          <input type="checkbox" checked={settings.demo_mode} onChange={(event) => setSettings({ ...settings, demo_mode: event.target.checked })} />
          <span>Demo mode deterministic audit data</span>
        </label>
        <p className="muted">Ollama URL: {settings.ollama_base_url}</p>
        <p className="muted">Current AI mode: {activeProviderLabel} - {activeModelLabel}</p>
        <p className="muted">OpenAI configured: {settings.openai_configured ? "yes" : "no"} | Claude configured: {settings.anthropic_configured ? "yes" : "no"}</p>
        <p className="muted">
          API keys entered here are used by the running backend session. To make them available after restarting Docker, add them to your local <code>.env</code> file.
        </p>
        <div className="button-row">
          <Button onClick={save}>Save Settings</Button>
          <Button variant="secondary" onClick={test}>Test Provider</Button>
        </div>
        {message ? <p className="message-text">{message}</p> : null}
      </Card>
      <Card className="settings-card about-card">
        <div>
          <p className="eyebrow">About</p>
          <h2>AuditCopilot</h2>
        </div>
        <p>
          AuditCopilot is an open-source visual AI audit workspace for planning, fieldwork, findings, and reporting.
        </p>
        <p>
          It helps auditors generate audit objectives, risks, tests, interview plans, findings, and report drafts using local or user-configured AI providers.
        </p>
        <p>Created by <CreatorLink />.</p>
        <p>Feedback or questions? Reach out on <FeedbackLink>LinkedIn</FeedbackLink>.</p>
      </Card>
      <Card className="settings-card">
        <div>
          <p className="eyebrow">Danger zone</p>
          <h2>Delete this audit</h2>
        </div>
        <p className="muted">
          Permanently delete this audit and its local project files. This cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>Delete Audit</Button>
      </Card>
      {showDeleteConfirm ? (
        <Modal title="Delete audit permanently?" onClose={() => setShowDeleteConfirm(false)}>
          <div className="modal-body">
            <p>
              This will permanently delete <strong>{projectTitle}</strong> and all files stored for this audit.
            </p>
            <p className="muted">Type DELETE to confirm.</p>
            <TextInput label="Confirmation" value={deleteConfirmText} onChange={(event) => setDeleteConfirmText(event.target.value)} />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" onClick={deleteAudit} disabled={deleting || deleteConfirmText !== "DELETE"}>
                {deleting ? "Deleting" : "Delete Audit Permanently"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
