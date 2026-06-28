import { useCallback, useEffect, useState } from "react";
import { agentRunsApi, type AgentRunLog } from "../api/agentRunsApi";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";


function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "In progress";
}

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function promptExchanges(value: unknown) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => {
    if (!item || typeof item !== "object") return { systemPrompt: "", userPrompt: String(item ?? "") };
    const fields = item as Record<string, unknown>;
    return {
      systemPrompt: typeof fields.system_prompt === "string" ? fields.system_prompt : "",
      userPrompt: typeof fields.user_prompt === "string" ? fields.user_prompt : "",
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rawResponses(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function responseContent(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const ollamaContent = value.message;
    if (isRecord(ollamaContent) && typeof ollamaContent.content === "string") return ollamaContent.content;
    const choices = value.choices;
    if (Array.isArray(choices) && isRecord(choices[0])) {
      const message = choices[0].message;
      if (isRecord(message) && typeof message.content === "string") return message.content;
    }
    const content = value.content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  }
  return jsonText(value);
}

function buildExchanges(run: AgentRunLog) {
  const prompts = promptExchanges(run.final_prompt);
  const responses = rawResponses(run.raw_llm_response);
  const count = Math.max(prompts.length, responses.length, 1);
  return Array.from({ length: count }, (_, index) => ({
    systemPrompt: prompts[index]?.systemPrompt || "",
    userPrompt: prompts[index]?.userPrompt || "",
    output: responseContent(responses[index]) || (index === count - 1 ? responseContent(run.parsed_output) : ""),
  }));
}

function LlmExchangeView({ exchange }: { exchange: ReturnType<typeof buildExchanges>[number] }) {
  return (
    <div className="agent-run-exchange">
      <section className="agent-run-simple-section">
        <h3>Input to LLM</h3>
        <h4>System prompt</h4>
        <pre className="agent-run-log-content">{exchange.systemPrompt || "No system prompt recorded."}</pre>
        <h4>User prompt</h4>
        <pre className="agent-run-log-content">{exchange.userPrompt || "No user prompt recorded."}</pre>
      </section>
      <section className="agent-run-simple-section">
        <h3>Output from LLM</h3>
        <pre className="agent-run-log-content">{exchange.output || "No LLM output recorded."}</pre>
      </section>
    </div>
  );
}

export function AgentRunLogsScreen({ projectId, projectTitle }: { projectId: string; projectTitle: string }) {
  const [runs, setRuns] = useState<AgentRunLog[]>([]);
  const [selected, setSelected] = useState<AgentRunLog | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [exchangePage, setExchangePage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await agentRunsApi.list(projectId));
      setMessage("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to load agent run logs.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function openRun(runId: string) {
    try {
      setExchangePage(0);
      setSelected(await agentRunsApi.get(projectId, runId));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to load agent run log.");
    }
  }

  async function deleteRun(runId: string) {
    if (!window.confirm("Delete this agent run log?")) return;
    await agentRunsApi.delete(projectId, runId);
    setSelected(null);
    await load();
  }

  return (
    <section className="screen-panel">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Agent run logs</p>
          <h2>{projectTitle}</h2>
        </div>
        <Button variant="ghost" onClick={load}>Refresh</Button>
      </header>
      {message ? <p className="message-text">{message}</p> : null}
      {!loading && runs.length === 0 ? <EmptyState title="No agent run logs" description="Agent run metadata will appear here after an agent executes." /> : null}
      <div className="agent-run-log-list">
        {runs.map((run) => (
          <Card key={run.run_id} className="agent-run-log-card">
            <div className="agent-run-log-heading">
              <div>
                <strong>{run.agent_name}</strong>
                <span>{run.run_id}</span>
              </div>
              <Badge>{run.status}</Badge>
            </div>
            <dl className="agent-run-log-grid">
              <dt>Started</dt><dd>{formatDate(run.started_at)}</dd>
              <dt>Completed</dt><dd>{formatDate(run.completed_at)}</dd>
              <dt>Provider / model</dt><dd>{run.provider} / {run.model}</dd>
              <dt>Selected items</dt><dd>{run.selected_item_ids.length}</dd>
              <dt>Outputs</dt><dd>{run.output_object_ids.length}</dd>
              <dt>Full I/O</dt><dd>{run.full_io_logged ? "Yes" : "No"}</dd>
              <dt>Raw response</dt><dd>{run.raw_response_logged ? "Yes" : "No"}</dd>
            </dl>
            <Button variant="secondary" onClick={() => openRun(run.run_id)}>View details</Button>
          </Card>
        ))}
      </div>
      {selected ? (
        <Modal title="Agent Run Log" className="agent-run-log-modal" onClose={() => setSelected(null)}>
          <div className="modal-body">
            {(() => {
              const exchanges = buildExchanges(selected);
              const currentPage = Math.min(exchangePage, exchanges.length - 1);
              const currentExchange = exchanges[currentPage];
              return (
                <>
            <dl className="agent-run-log-grid">
              <dt>Agent</dt><dd>{selected.agent_name}</dd>
              <dt>Status</dt><dd>{selected.status}</dd>
              <dt>Provider / model</dt><dd>{selected.provider} / {selected.model}</dd>
              <dt>Run ID</dt><dd>{selected.run_id}</dd>
            </dl>
            {selected.error_message ? <p className="error-banner">{selected.error_message}</p> : null}
            {!selected.full_io_logged ? (
              <p className="muted">Full prompt/context/output logging was disabled for this run. Only metadata is available.</p>
            ) : (
              <>
                {exchanges.length > 1 ? (
                  <div className="agent-run-exchange-pager">
                    <Button variant="secondary" disabled={currentPage === 0} onClick={() => setExchangePage((page) => Math.max(0, page - 1))}>Previous</Button>
                    <strong>{currentPage + 1} / {exchanges.length}</strong>
                    <Button variant="secondary" disabled={currentPage === exchanges.length - 1} onClick={() => setExchangePage((page) => Math.min(exchanges.length - 1, page + 1))}>Next</Button>
                  </div>
                ) : null}
                <LlmExchangeView exchange={currentExchange} />
              </>
            )}
            <div className="modal-actions">
              <Button variant="danger" onClick={() => deleteRun(selected.run_id)}>Delete log</Button>
            </div>
                </>
              );
            })()}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
