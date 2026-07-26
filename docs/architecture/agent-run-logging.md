# Agent Run Logging

Agent run logs provide traceability, debugging information, and transparency for AI-generated audit work. Logging is separate from project JSON because logs have different privacy, retention, and access requirements.

## Metadata And Full I/O

Metadata logging records operational facts:

- Run, project, and agent identifiers
- Status and timestamps
- Provider and model
- Selected audit item IDs
- Context recipe, blocks, token estimate, and truncation status
- Generated output object IDs
- Error messages
- Whether full I/O or raw responses were stored

Full I/O logging can additionally store:

- Rendered context
- Final system/user prompt exchanges
- Parsed output

Raw response logging can store the provider response separately. Raw responses may contain audit content and provider metadata, so this option is independently configurable.

The logger never intentionally stores API keys, admin secrets, authentication tokens, cookies, request headers, or environment variables.

## Configuration

```env
AGENT_RUN_LOGS_ENABLED=true
AGENT_RUN_LOG_FULL_IO=false
AGENT_RUN_LOG_RAW_RESPONSE=false
AGENT_RUN_LOG_RETENTION_DAYS=30
AGENT_RUN_LOG_DIR=agent_runs
ALLOW_HOSTED_FULL_AGENT_LOGS=false
```

Settings can also be changed for the current backend session from the Settings screen.

### Local Mode

Metadata logging is enabled by default. Users can enable full I/O and raw response logging. Full logging may store sensitive audit content on the local machine.

### Hosted Mode

Full I/O and raw response logging are disabled by default. Hosted users cannot enable them unless `ALLOW_HOSTED_FULL_AGENT_LOGS=true` is configured on the backend. The backend enforces this policy even if a client sends a direct API request.

The public version does not currently have per-user project ownership. Therefore hosted log access and logging-setting changes require an authenticated admin. Anonymous hosted users cannot view logs.

## Storage

Logs are stored outside the main project files:

```text
PROJECTS_DIR/
  agent_runs/
    <project_id>/
      <run_id>.json
```

`project_id` and `run_id` are validated before filesystem access. Arbitrary paths and path traversal values are rejected. The configured log directory must be relative to `PROJECTS_DIR`.

Retention cleanup removes logs older than `AGENT_RUN_LOG_RETENTION_DAYS`. Cleanup runs when logging settings are updated and can also be called through `AgentRunLogService.cleanup_old_runs()`.

## Runtime Flow

1. Resolve the agent and selected items.
2. Build the agent-specific Context Pack.
3. Start an agent run log with safe metadata.
4. Execute one or more LLM calls.
5. Parse and validate the response.
6. Save generated audit objects.
7. Complete the run log with output IDs and optional content.
8. If execution fails, mark the run as `error` and store the safe error message.

Logging failures do not prevent the agent run from completing.

## API

Project-level endpoints:

```text
GET    /api/projects/{project_id}/agent-runs
GET    /api/projects/{project_id}/agent-runs/{run_id}
DELETE /api/projects/{project_id}/agent-runs/{run_id}
```

Admin endpoint:

```text
GET /api/admin/agent-runs
```

Logging settings:

```text
GET /api/settings/agent-run-logs
PUT /api/settings/agent-run-logs
```

## UI

The Settings screen contains an **Agent run logging** section with:

- Metadata logging toggle
- Full prompt/context/output toggle
- Raw response toggle
- Retention days
- Log directory label
- Privacy warning
- **View agent run logs** button

The log viewer shows run metadata and optional full content. When full I/O was disabled, the viewer explicitly states that only metadata is available.

## Developer Notes

Logging is implemented by `backend/app/services/agent_run_log_service.py`. Individual generator implementations do not write files. The central agent runtime starts, completes, or fails a run, while a lightweight capture object gathers LLM prompt/response exchanges.

When adding a new map agent, use the existing central execution path so logging and Context Pack behavior are inherited automatically.
