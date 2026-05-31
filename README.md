# AuditCopilot

Open-source visual AI audit workspace for planning, testing, findings, and reporting.

Created by [Erdem Capci](https://www.linkedin.com/in/erdemcapci/).

For feedback, questions, ideas, or collaboration, feel free to reach out on LinkedIn.

AuditCopilot helps auditors turn a simple audit title and description into a visual audit map: Audit -> Planning -> Fieldwork -> Reporting. It is an AI-native audit thinking and planning tool, not a GRC platform.

GitHub repository: [https://github.com/erdemcapci/audit-ai](https://github.com/erdemcapci/audit-ai)

## Repository Note

This repository contains the hosted showcase version of AuditCopilot.

The open-source/local-first core is available at:
https://github.com/erdemcapci/audit-ai

This showcase version includes additional hosted-demo features such as user sign-in, admin-approved AI access, usage limits, legal pages, and Railway deployment configuration.

## Who It Is For

AuditCopilot is for auditors who want a local-first workspace to think through an audit visually.

It helps with:

- Planning an audit from a title and description
- Generating objectives, risks, and tests
- Creating interview plans
- Organizing fieldwork and findings
- Drafting executive summaries and reports
- Keeping audit project data in local files

## For Non-Technical Users

If you are not technical, start here:

[User Manual for Auditors](USER_MANUAL.md)

The manual explains how to install/start the app and how to use the audit map step by step. It is written for users who do not know Git, Bash, Python, Node, or Docker commands.

Typical first-time setup with Docker Desktop takes about 15-30 minutes, depending on download speed. After setup, starting the app again usually takes 1-2 minutes.

For a detailed explanation of what the tool does and where AI supports the audit process, read:

[AuditCopilot Tool Overview](TOOL_OVERVIEW.md)

## Quickstart

The simplest startup path is Docker Compose.

From the folder where you want to download the project, copy and paste:

```bash
git clone https://github.com/erdemcapci/audit-ai.git
cd audit-ai
cp .env.example .env
docker compose up
```

If you already downloaded the project ZIP from GitHub, open a terminal in the extracted project folder and run only:

```bash
cp .env.example .env
docker compose up
```

Then open:

```text
http://localhost:3000
```

`DEMO_MODE=true` is enabled by default, so the app works without Ollama, OpenAI, or Claude.

## Optional Local AI

AuditCopilot supports:

- Ollama
- OpenAI
- Claude

For local Ollama:

```bash
ollama pull llama3.1:8b
```

For local non-Docker Ollama, use:

```env
OLLAMA_BASE_URL=http://localhost:11434
```

For Docker on Mac, use:

```env
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

OpenAI and Claude require API keys in `.env`.

## Deployment Modes

AuditCopilot supports two runtime modes:

- `DEPLOYMENT_MODE=local`: local downloaded version. Users can run AI agents when Ollama, OpenAI, Claude, or demo mode is configured.
- `DEPLOYMENT_MODE=hosted`: hosted showcase version. Public visitors can explore public sample data and create browser/session temporary audits, but real AI generation requires a signed-in user with admin-approved AI access and remaining total runs.

For hosted admin access, configure:

```env
DEPLOYMENT_MODE=hosted
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key_here
ADMIN_SECRET=choose_a_secret
SESSION_SECRET=choose_a_different_long_random_secret
AI_DEFAULT_TOTAL_LIMIT=50
PASSWORD_MIN_LENGTH=10
AUTH_RATE_LIMIT_ATTEMPTS=10
ADMIN_RATE_LIMIT_ATTEMPTS=5
RATE_LIMIT_WINDOW_SECONDS=300
MAX_ANONYMOUS_PROJECTS=3
MAX_USER_PROJECTS=20
PROJECTS_DIR=/data/projects
CORS_ORIGIN_REGEX=https://.*\\.up\\.railway\\.app
VITE_LEGAL_PROVIDER_NAME=Erdem Capci
VITE_LEGAL_PROVIDER_ADDRESS=Your legal address
VITE_LEGAL_PROVIDER_EMAIL=contact@example.com
VITE_LEGAL_PROVIDER_COUNTRY=Germany
VITE_LEGAL_PROVIDER_LINKEDIN=https://www.linkedin.com/in/erdemcapci/
```

Admin users can open `/admin`, log in with `ADMIN_SECRET`, approve user AI access, set each user's total run limit, reset used runs, revoke access, and create a full end-to-end demo audit.

Hosted deployments use JSON storage under `PROJECTS_DIR`. Railway's normal container filesystem is ephemeral, so any files written inside the app container can disappear on redeploy. Add a Railway persistent volume and point `PROJECTS_DIR` at that mounted volume.

Recommended Railway setup:

```text
Volume mount path: /data
PROJECTS_DIR=/data/projects
```

The app creates `PROJECTS_DIR` if it does not exist and logs the resolved path on startup. All persistent JSON data is stored under this directory, including project workspaces, anonymous temporary audits, signed-in private audits, `users.json`, AI access grants, usage counters, generated report markdown, and the public sample audit. Login/admin/anonymous sessions are signed HTTP-only cookies, not server-side JSON files.

If you keep `PROJECTS_DIR` inside the app working directory in hosted mode, startup logs will print a warning because that location is not safe for Railway redeploys.

Before public launch, complete the legal provider environment variables used by `/impressum`, `/privacy`, and `/terms`. The hosted demo uses only strictly necessary HTTP-only session cookies for login/admin/anonymous demo sessions; add a cookie consent banner before introducing analytics, tracking, or other non-essential cookies.

## Local Development

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Privacy

- Your data is stored locally in the `projects` directory.
- Ollama mode keeps LLM processing local.
- OpenAI/Claude modes send prompts to external providers you configure.
- Do not enter confidential data into external APIs unless approved by your organization.

## Storage

Projects are stored as local JSON files:

```text
projects/
  {project_slug}/
    audit.json
    planning.json
    interview_plan.json
    fieldwork.json
    findings.json
    report.json
    report.md
    documents/
```

No database is required for v0.1.

## License

AuditCopilot is licensed under the GNU Affero General Public License v3.0 (AGPLv3).

You may use, modify, and self-host this software under the terms of the AGPLv3.

If you modify AuditCopilot and provide it as a network service, you must make the modified source code available under the same license.

Copyright (C) 2026 Erdem Capci

## Disclaimer

AuditCopilot provides AI-assisted audit planning, fieldwork, finding drafting, and reporting support.

AI-generated outputs may be incomplete or inaccurate. Users remain responsible for professional judgment, validation, regulatory compliance, and compliance with their organization’s policies.

## Creator

AuditCopilot was created by [Erdem Capci](https://www.linkedin.com/in/erdemcapci/).

If you use the project, find it useful, or have feedback, I’d be happy to hear from you.
