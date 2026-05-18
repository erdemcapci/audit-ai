# AuditCopilot User Manual

This manual is for auditors and non-technical users who want to start AuditCopilot and use it for an audit.

AuditCopilot runs locally on your computer. Your audit project files are stored in the local `projects` folder.

You do not need to know programming to use AuditCopilot. Some setup steps require copying and pasting commands into a terminal, but the commands are provided exactly as you need them.

## Quick Answer: How Long Will Setup Take?

For a non-technical user:

- First-time setup: usually 15-30 minutes
- First app startup: usually 3-10 minutes because Docker may build the app
- Later startups: usually 1-2 minutes
- Learning the main audit workflow: about 15-20 minutes

The slowest parts are installing Docker Desktop and waiting for the first build.

## Table of Contents

- [What AuditCopilot Does](#what-auditcopilot-does)
- [Before You Start](#before-you-start)
- [Option 1: Start with Docker Desktop](#option-1-start-with-docker-desktop)
- [Option 2: Use Local AI with Ollama](#option-2-use-local-ai-with-ollama)
- [Option 3: Use OpenAI or Claude](#option-3-use-openai-or-claude)
- [How to Use AuditCopilot](#how-to-use-auditcopilot)
- [Deleting Cards](#deleting-cards)
- [Where Your Data Is Stored](#where-your-data-is-stored)
- [Troubleshooting](#troubleshooting)

## What AuditCopilot Does

AuditCopilot helps you turn a short audit description into a visual audit map:

```text
Planning -> Fieldwork -> Findings -> Reporting
```

You can use it to:

- Generate audit objectives
- Generate risks
- Generate audit tests
- Generate interview plans
- Track fieldwork items
- Draft findings
- Generate executive summaries and draft reports
- Export a markdown report

AI output is a draft. You remain responsible for reviewing, editing, validating, and applying professional judgment.

For a more detailed explanation of the tool, the audit steps, and where AI can support the process, see:

[AuditCopilot Tool Overview](TOOL_OVERVIEW.md)

## Before You Start

For the easiest setup, you need:

- A computer running Windows, macOS, or Linux
- Docker Desktop installed
- The AuditCopilot project folder

You do not need an AI account to try the app. Demo mode is enabled by default.

### What Is Docker Desktop?

Docker Desktop is the easiest way to run AuditCopilot without installing developer tools one by one.

Instead of asking you to install Python, Node.js, frontend dependencies, and backend dependencies separately, Docker starts the full app for you.

### What Is a Terminal?

A terminal is a simple window where you can paste startup commands.

On macOS it is usually called `Terminal`.

On Windows it may be called `Command Prompt`, `PowerShell`, or `Terminal`.

You do not need to understand the commands. In this manual, copy and paste them exactly.

## Option 1: Start with Docker Desktop

This is the recommended setup for most users.

### Step 1: Install Docker Desktop

Download Docker Desktop from:

```text
https://www.docker.com/products/docker-desktop/
```

Install it and open Docker Desktop.

Wait until Docker Desktop says it is running.

### Step 2: Get AuditCopilot

If you are using GitHub and do not know Git:

1. Open the AuditCopilot GitHub page:

```text
https://github.com/erdemcapci/audit-ai
```

2. Click the green `Code` button.
3. Click `Download ZIP`.
4. Unzip the downloaded file.
5. Move the folder somewhere easy to find, such as Desktop or Documents.

If you know Git, you can clone the repository instead.

Clone command:

```text
git clone https://github.com/erdemcapci/audit-ai.git
```

### Step 3: Open a terminal in the project folder

You need to run two commands from the AuditCopilot folder.

On macOS:

1. Open the AuditCopilot folder in Finder.
2. Right-click the folder area.
3. Choose `New Terminal at Folder` if available.

On Windows:

1. Open the AuditCopilot folder in File Explorer.
2. Click the address bar.
3. Type `cmd`.
4. Press Enter.

If these options are not available, open Terminal or Command Prompt and navigate to the project folder.

The important point is that the terminal must be opened inside the same folder that contains files such as:

- `README.md`
- `.env.example`
- `docker-compose.yml`
- `frontend`
- `backend`

### Step 4: Create the environment file

Copy and paste this command:

```bash
cp .env.example .env
```

On Windows Command Prompt, if `cp` does not work, use:

```bat
copy .env.example .env
```

### Step 5: Start the app

Copy and paste:

```bash
docker compose up
```

The first start can take several minutes because Docker builds the app.

When it is running, open your browser and go to:

```text
http://localhost:3000
```

Leave the terminal window open while using AuditCopilot. If you close it, the app may stop.

### Step 6: Stop the app

Go back to the terminal window where Docker is running.

Press:

```text
Ctrl + C
```

To start again later, open the project folder and run:

```bash
docker compose up
```

## Daily Startup After First Setup

After the first setup, you normally only need to:

1. Open Docker Desktop.
2. Open a terminal in the AuditCopilot folder.
3. Run:

```bash
docker compose up
```

4. Open:

```text
http://localhost:3000
```

## Option 2: Use Local AI with Ollama

This is optional.

By default, AuditCopilot uses demo mode, so it can work without Ollama or API keys.

If you want local AI:

1. Install Ollama:

```text
https://ollama.com/
```

2. Pull the default model:

```bash
ollama pull llama3.1:8b
```

3. Open `.env`.
4. Set:

```env
DEMO_MODE=false
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

For non-Docker local development, use:

```env
OLLAMA_BASE_URL=http://localhost:11434
```

## Option 3: Use OpenAI or Claude

This is optional and sends prompts to the provider you configure.

Only use external AI providers if your organization allows it.

### Use OpenAI or Claude from the Settings screen

After the app is open:

1. Click `Settings`.
2. Choose `OpenAI` or `Claude` as the provider.
3. Enter the model name.
4. Paste your API key into the API key box.
5. Turn off `Demo mode deterministic audit data`.
6. Click `Save Settings`.
7. Click `Test Provider`.

API keys entered in the Settings screen are used by the running backend session. If you stop and restart Docker, enter the key again or save it in `.env`.

### Use OpenAI or Claude from `.env`

In `.env`, set:

```env
DEMO_MODE=false
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key_here
```

or:

```env
DEMO_MODE=false
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=your_key_here
```

Restart the app after changing `.env`.

## How to Use AuditCopilot

### 1. Start a New Audit

When the app opens, you will see the start screen.

Enter:

- Audit Title
- Audit Description

Optional fields:

- Business / Process Area
- Initial Concern
- Extra Context

Click:

```text
Build my audit map
```

AuditCopilot creates a local project and opens the audit workspace.

### 2. Understand the Main Map

The main map is a visual audit board.

It has phase areas:

- Planning
- Fieldwork
- Reporting

Cards represent audit objects such as:

- Workstreams
- Objectives
- Risks
- Tests
- Interview roles/questions
- Fieldwork items
- Findings
- Report sections
- Agent cards

Arrows show relationships between cards.

### 3. Focus on a Phase

Use the `Focus Phase` dropdown above the map.

Options:

- All phases
- Planning
- Fieldwork
- Reporting

This helps you focus on the current audit stage.

### 4. Move Around the Map

You can:

- Use the horizontal and vertical scrollbars on the map.
- Use the zoom controls.
- Right-click or middle-click and drag to pan.
- Use `Fit View` to reset the view.

To select several cards, left-click and drag on empty map space.

### 5. Edit a Card

Click a card.

The right panel shows editable fields for that card.

You can edit titles, descriptions, risk severity, test details, finding fields, and other card-specific information.

Click `Save Card` or `Save Agent` after editing.

### 6. Use Agent Cards

AI generation should happen through agent cards on the map.

Agent cards can generate outputs such as:

- Risks
- Tests
- Interview plans
- Findings
- Report drafts

Typical use:

1. Add an agent card from the `Add Agent` control.
2. Connect it to related cards.
3. Configure the agent in the right panel.
4. Run the agent from the agent card on the map.

If the connected cards already have outputs, AuditCopilot asks whether you want to:

- Cancel
- Delete old outputs and create new ones
- Keep old outputs and add new ones

### 7. Follow the Guided Checklist

When no card is selected, the right panel shows the guided checklist.

The checklist is grouped by phase:

- Planning
- Interviews
- Fieldwork
- Findings
- Reporting

Click a phase heading to expand or collapse it.

The checklist shows major actions only. Editing and review happen directly inside the map cards.

### 8. Planning Workflow

A typical planning flow is:

1. Generate objectives.
2. Review and edit objective cards.
3. Confirm objectives and generate risks.
4. Review and edit risk cards.
5. Confirm risks and generate tests.
6. Review and edit test cards.
7. Approve planning.

The goal is not to accept AI output blindly. Treat generated content as a draft.

### 9. Interviews

Generate an interview plan after planning exists.

Interview cards can include:

- Interviewee roles
- Rationale
- Expected information
- Questions

Edit the cards as needed.

### 10. Fieldwork

Create fieldwork items from approved planning.

Each test can become a fieldwork item.

You can update:

- Status
- Notes
- Expected evidence
- Evidence placeholders

### 11. Findings

Findings can be drafted from fieldwork observations.

A finding may include:

- Issue / condition
- Criteria
- Root cause
- Impact
- Recommendation
- Management action
- Severity

Review and edit all finding text before using it.

### 12. Reporting

Use reporting actions to generate:

- Executive summary
- Audit conclusion
- Issue summary
- Draft report structure

Edit report cards before sharing with stakeholders.

### 13. Export a Report

Use the export action to create a markdown report.

Markdown files can be opened in many editors and converted later to other formats.

## Deleting Cards

When you select a card, the right panel can show cleanup actions.

You may see:

- Delete outputs
- Delete card
- Delete all cards in the same dimension

Examples:

- Selecting a test card can delete all tests.
- Selecting a risk card can delete all risks and tests.
- Selecting a finding card can delete all findings.

Be careful. These actions update your local project files.

## Where Your Data Is Stored

Projects are stored in:

```text
projects/
```

Each project has JSON files such as:

```text
audit.json
planning.json
interview_plan.json
fieldwork.json
findings.json
report.json
```

If you want to back up your audits, back up the `projects` folder.

## Troubleshooting

### Docker is not running

Open Docker Desktop and wait until it says it is running.

Then run:

```bash
docker compose up
```

### The app does not open at localhost:3000

Check that Docker is still running.

Try opening:

```text
http://127.0.0.1:3000
```

### Port already in use

Another app may already be using port 3000 or 8000.

Open `.env` and change:

```env
FRONTEND_PORT=3001
BACKEND_PORT=8001
```

Then restart:

```bash
docker compose up
```

Open:

```text
http://localhost:3001
```

### AI output is generic

Add more context in the audit description or optional fields.

Useful context includes:

- Process name
- Systems used
- Known concerns
- Regulations or policies
- Time period
- Business unit

### External AI is not working

Check:

- `DEMO_MODE=false`
- Correct provider in `.env`
- API key is present
- Your network allows access to the provider

## Important Disclaimer

AuditCopilot provides AI-assisted audit planning, fieldwork, finding drafting, and reporting support.

AI-generated outputs may be incomplete or inaccurate. Users remain responsible for professional judgment, validation, regulatory compliance, and compliance with their organization’s policies.

## Feedback

AuditCopilot was created by [Erdem Capci](https://www.linkedin.com/in/erdemcapci/).

For feedback, questions, suggestions, or collaboration, feel free to reach out on LinkedIn.
