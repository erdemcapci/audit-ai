# AuditCopilot Tool Overview

This document explains what AuditCopilot does, how it supports an audit, and where AI can help during the audit lifecycle.

AuditCopilot is an open-source visual AI audit workspace. It is designed to help auditors think through an audit from a simple title and description, then turn that starting point into a structured audit map.

It is not a GRC system, audit issue tracker, approval workflow, or enterprise audit management platform. It is a local-first thinking, planning, drafting, and documentation aid for auditors.

## What AuditCopilot Does

AuditCopilot helps an auditor move from:

```text
Audit idea -> Objectives -> Risks -> Tests -> Fieldwork -> Findings -> Report
```

The main screen is a visual map. The map shows audit cards connected with arrows so the auditor can see how the audit logic fits together.

For example:

```text
Objective -> Risk -> Test -> Fieldwork Item -> Finding -> Report
```

The purpose is to make the audit journey visible. Instead of managing audit planning in a flat document or spreadsheet, the auditor can see the structure of the audit as connected cards.

## Core Principles

AuditCopilot is built around these principles:

- Local-first: project files are stored locally on the user's computer.
- Visual-first: the audit map is the main workspace.
- AI suggests, auditor decides: AI output is draft material, not final audit work.
- Editable: generated cards can be reviewed and changed by the auditor.
- Lightweight: no database, no authentication, no enterprise workflow.
- Practical: the tool focuses on objectives, risks, tests, interviews, fieldwork, findings, and reports.

## Main Audit Phases

AuditCopilot organizes the map into three high-level phase areas:

- Planning
- Fieldwork
- Reporting

The user journey is more detailed:

```text
Understand -> Plan -> Interview -> Test -> Report
```

The phase areas help the auditor see where each card belongs. Planning cards sit in the Planning area, fieldwork and finding cards sit in the Fieldwork area, and report cards sit in the Reporting area.

## What the AI Can Support

AI support is provided through visible agent cards on the audit map. These are not hidden background automations. The auditor can add an agent card, connect it to relevant audit cards, configure it, edit its prompt, and run it manually.

AI can support these steps:

- Generate objectives and workstreams from an audit title and description
- Generate risks linked to confirmed objectives
- Generate audit tests linked to risks
- Generate interview roles and questions
- Draft findings from rough observations or fieldwork items
- Generate executive summaries and draft report sections

The AI does not approve audit work, make professional judgments, or replace auditor review.

## Step 1: Start Audit

The auditor begins with:

- Audit Title
- Audit Description

Optional context can include:

- Business or process area
- Initial concern
- Extra background information

AI can help by using this information to create an initial audit structure. The better the description, the more relevant the output usually becomes.

Example input:

```text
Audit Title: Procurement Process Audit

Audit Description:
Review whether procurement activities are properly approved, vendor onboarding is controlled, purchase orders are matched to invoices, and segregation of duties is maintained.
```

## Step 2: Generate Objectives and Workstreams

AI can suggest audit workstreams and objectives.

Examples:

- Procurement Governance
- Vendor Selection
- Purchase Approval
- Invoice Matching
- Segregation of Duties

Each objective can include:

- Title
- Description
- Rationale
- Scope notes
- Open questions

The auditor should review the objectives and edit them directly in the node detail panel. This step is important because the objectives drive the rest of the audit.

Auditor responsibility:

- Confirm the objectives reflect the real audit scope.
- Remove objectives that are not relevant.
- Add missing objectives.
- Clarify vague wording.

## Step 3: Generate Risks

After objectives are in place, AI can generate risks connected to those objectives.

Each risk may include:

- Title
- Description
- Why it matters
- Potential impact
- Severity
- Linked objective

Example risks for procurement:

- Unauthorized purchases
- Vendor onboarding without due diligence
- Duplicate or incorrect payments
- Approval limits not followed
- Conflicting access rights

Auditor responsibility:

- Confirm the risk is realistic for the process.
- Adjust severity based on judgment.
- Remove generic risks.
- Add risks based on known business context.

## Step 4: Generate Tests

After risks are reviewed, AI can generate audit tests for each risk.

Each test may include:

- Title
- Test type
- Test objective
- Description
- Expected evidence
- Sample considerations
- Linked risk
- Linked objective

Supported test types include:

- Test of Design
- Test of Operating Effectiveness
- Detailed Test
- Analytical Review
- Inquiry / Interview

Example tests:

- Review approval matrix
- Test a sample of purchase orders
- Inspect vendor onboarding evidence
- Compare invoices to purchase orders and goods receipts
- Review user access roles

Auditor responsibility:

- Make sure each test addresses the linked risk.
- Check that expected evidence is available.
- Adjust sample approach based on audit methodology.
- Remove tests that are not practical or relevant.

## Step 5: Generate Interview Plan

AI can create an interview plan from the planning hierarchy.

The output can include:

- Interviewee roles
- Rationale for each role
- Expected information
- Questions grouped by role
- Mapping to objectives, risks, or tests where possible

Example interview roles:

- Process Owner
- Control Owner
- System Owner
- Finance Manager
- Compliance Officer
- Operations Lead
- Vendor Manager

Auditor responsibility:

- Replace generic role names with actual stakeholder names when known.
- Remove unnecessary questions.
- Add questions specific to the organization.
- Use the questions as a starting point, not a script that must be followed rigidly.

## Step 6: Create Fieldwork Items

When planning is approved, tests can become fieldwork items.

Each fieldwork item can include:

- Test title
- Test type
- Description
- Expected evidence
- Status
- Notes
- Linked finding IDs

Common statuses include:

- Not Started
- In Progress
- Completed
- Issue Identified

AI is less central in this step. The main purpose is to turn approved tests into actionable fieldwork cards.

Auditor responsibility:

- Update status as work progresses.
- Add fieldwork notes.
- Document evidence reviewed.
- Identify where exceptions or issues exist.

## Step 7: Draft Findings

If fieldwork identifies an issue, AI can help turn a rough observation into a structured finding draft.

Input can be a rough description such as:

```text
Several purchase orders in the sample were approved after the invoice date, and approval evidence was inconsistent.
```

AI can draft:

- Finding title
- Issue / condition
- Criteria
- Root cause
- Impact / risk
- Recommendation
- Management action suggestion
- Severity
- Evidence needed
- Validation questions

Auditor responsibility:

- Verify facts against evidence.
- Confirm criteria are correct.
- Validate root cause with management.
- Ensure the recommendation is practical.
- Make sure severity is justified.
- Rewrite the finding in the audit team's required style.

## Step 8: Generate Reporting Content

AI can support reporting by drafting:

- Executive summary
- Audit conclusion
- Key themes
- Issue summary
- Management attention points
- Draft report structure

The report content is generated from planning, fieldwork items, and findings.

Auditor responsibility:

- Confirm the report reflects actual fieldwork.
- Remove unsupported statements.
- Align wording with audit methodology.
- Validate tone and severity.
- Obtain required internal review before sharing.

## Agent Cards

Agent cards are visible AI tools on the map.

Each agent card can have:

- Agent type
- Title
- Prompt
- Configuration
- Status
- Connected inputs
- Run button

Examples:

- Risk Generator
- Test Generator
- Interview Plan Generator
- Finding Draft Agent
- Report Draft Agent

The auditor can connect an agent to related cards. For example, a Test Generator can connect to risk cards. If it is connected to 3 risks and configured to create 2 tests per risk, it can generate 6 test cards.

If connected cards already have outputs, the app can ask whether to:

- Cancel the run
- Delete old outputs and create new ones
- Keep old outputs and add new ones

## Editing and Review

All AI-generated content should be reviewed.

The auditor can click cards and edit fields directly in the right panel. This includes objectives, risks, tests, interview questions, fieldwork items, findings, reports, and agents.

The review process is intentionally built into the map. The auditor does not need a separate review screen for every object.

## What AuditCopilot Does Not Do

AuditCopilot does not:

- Replace auditor judgment
- Validate evidence automatically
- Guarantee regulatory compliance
- Manage audit approvals
- Enforce an audit methodology
- Store data in a cloud database
- Provide authentication or role-based access
- Act as a full GRC platform

It is a planning, thinking, drafting, and mapping tool.

## Local Data and Privacy

AuditCopilot stores projects in local files under the `projects` folder.

If demo mode or Ollama is used, the app can run without sending prompts to OpenAI or Claude.

If OpenAI or Claude is configured, prompts are sent to the selected external provider. Users should not enter confidential information into external AI services unless their organization permits it.

## Recommended Way to Use the Tool

Use AuditCopilot as an audit copilot, not as an automatic audit author.

A practical workflow is:

1. Enter a clear audit title and description.
2. Generate objectives.
3. Review and edit objectives.
4. Generate risks.
5. Review and edit risks.
6. Generate tests.
7. Review and edit tests.
8. Approve planning.
9. Generate interview plan.
10. Create fieldwork items.
11. Update fieldwork status and notes.
12. Draft findings when issues are identified.
13. Generate report content.
14. Review, rewrite, and export.

## Professional Judgment Reminder

AI-generated outputs may be incomplete, inaccurate, or too generic.

Users remain responsible for:

- Professional judgment
- Audit methodology compliance
- Evidence validation
- Regulatory compliance
- Organizational policy compliance
- Final report quality

AuditCopilot can accelerate thinking and drafting, but the auditor remains accountable for the audit work.

