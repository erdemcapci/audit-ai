# Data Quality Tests — Design

Status: Phase 1 (standard tests, run map, run storage) is implemented in
`frontend/src/features/data-quality/` and `backend/app/features/data_quality/`.
Phases 2–4 are design only. Where Phase 1 differs from the original design, the
section says so under "Phase 1 implementation".

## 1. Goal

An auditor with no technical background loads a dataset (CSV export from an ERP,
a spreadsheet, a ledger) and gets a complete data quality assessment without
having to know which tests exist or how to configure them. The tool then tells
them, in plain language, what the results mean and what to do next.

Two things the auditor does not have: technical knowledge and time. Every part of
the design is judged against those two constraints.

## 2. Principles

1. **AI decides, code computes.** AI chooses which tests to run and interprets the
   results. Every test itself is deterministic, pre-written and tested code. AI
   never writes or executes code (see decision D1).
2. **AI sees profiles, not rows.** AI receives column statistics, discovered
   relationships, result summaries and, optionally, a small masked sample. Cost
   and data exposure do not grow with the number of rows.
3. **AI is optional.** Every test runs without AI. AI adds semantic rules and
   interpretation on top; switching it off leaves a complete, useful product.
4. **One engine, one result format, one screen skeleton.** Standard tests and
   dataset-specific rules are both instances of the same templates.
5. **Every decision is explainable and recorded.** Automatic choices carry the
   numbers and the reason behind them (as the pattern engine already does). The
   whole run — what AI proposed, what the auditor changed, what ran, what was
   found — is logged and shown visually as a run map.
6. **Data stays on the auditor's installation.** Tests run in the browser. The
   backend stores the run (plan, results, logs) and a compressed copy of the source
   file in the project folder, and makes LLM calls with profile data only.
7. **A finished run never asks for anything again.** Reopening a run shows all
   results and details immediately: no re-upload, no re-run, no new AI call.
8. **Everything belongs to an audit project.** Runs, source files and saved rules
   live under the audit project that created them, like planning and fieldwork.
9. **English throughout.** UI text, generated sentences, AI prompts and AI output
   are in English, like the rest of the application. Data values are shown as
   they are, whatever their language.

## 3. Scope

In scope for this design:

- Single-file tabular datasets (CSV; the existing parser handles delimiters,
  encodings and quoting).
- Data quality: "is this data fit to be used for audit testing?"
- Dataset-specific business rules that can be expressed with the template
  catalog (section 6).

Out of scope for now (candidates for later phases):

- Multi-file tests (referential integrity between an invoice file and a vendor
  master).
- Audit analytics whose question is "is there risk in this data?" rather than
  "is this data usable?" (Benford, split purchases, duplicate payments within a
  time window). The template structure must allow adding them later.
- Fuzzy matching, time-window rules, aggregate rules.
- Pushing exceptions into fieldwork and the audit map. Rules carry a tag that
  makes this possible later (section 7.3).

## 4. Concepts

| Term | Meaning |
| --- | --- |
| **Template** | A pre-written, tested test function with typed parameters, e.g. `rule.conditional`. Lives in code. |
| **Test** | A template plus filled-in parameters, e.g. "if `close_date` is not empty then `status` is Closed". |
| **Test source** | Who created the test: `standard` (code, from column types), `discovered` (code, from statistical relationships), `ai` (AI #1), `auditor` (added manually). |
| **Plan** | The list of tests for a run, after the auditor's review. |
| **Run** | One execution of a plan on one dataset. Has a run map and a log. |
| **Result card** | The outcome of a test for one subject: a column for column tests, a rule for rule tests. |
| **Exception** | A record that fails a test. |

Standard and dataset-specific tests differ only in who filled in the parameters.
Technically they are the same thing.

## 5. End-to-end flow

```
Load CSV
  → [code]    Profile: technical types, statistics, date formats
  → [code]    Relationship discovery: dependencies, date order, conditional completeness, arithmetic
  → [code]    Standard plan: template instances from column types
  → [AI #1]   Semantic roles, parameter tuning, dataset-specific rules   (skipped if AI is off)
  → [code]    Validate every proposed test
  → [auditor] Review plan: approve, remove, add, edit
  → [code]    Run every test on every row
  → [code]    Classify, score, summarise
  → [AI #2]   Interpret: significance, meaning, actions, client questions   (skipped if AI is off)
  → [code]    Save run; optionally save rules to the project
```

Each arrow above is a node on the run map (section 11) and a step in the run log
(section 13).

### 5.1 AI on vs. off

| Stage | AI on | AI off |
| --- | --- | --- |
| Profile, discovery | code | code (same) |
| Standard tests | code fills, AI may tune parameters | code fills |
| Discovered relationships | AI names them and drops the meaningless ones | shown as "statistical discovery" suggestions, unchecked by default except strong ones; auditor picks |
| Dataset-specific rules | AI proposes | auditor can add manually with a form |
| Result summary | AI interpretation, adjusted severity, actions, client questions | template sentences and code-computed severity |

AI can also be switched on *after* a run: "Interpret with AI" sends only the
result summary (cheap) and adds the AI #2 node to the existing run.

## 6. Profiler and discovery (code)

### 6.1 Column profile

Extends the existing `profileDataset` (stage 1 of the pattern engine). For each
column, on all rows for counts and on the existing deterministic sample
(`PROFILE_SAMPLE = 5000`) for the heavier measures:

- Row count, blank count, placeholder count (see `completeness.placeholder`).
- Distinct values, uniqueness ratio, top values with counts, rare values.
- Pattern statistics (already present).
- **Technical type**, one of:
  `identifier`, `category`, `measure`, `date`, `boolean`, `free_text`, `constant`, `empty`.
  `isMeasure` and the pattern verdicts already provide most of this.
- For `date`: detected format (e.g. `dd.MM.yyyy`, `MM/dd/yyyy`, ISO), share of
  values that parse, min/max. If the format is ambiguous (every day ≤ 12) the
  profile says so and the auditor confirms the format on the plan screen.
- For `measure`: decimal separator, min/max, quantiles, share of negatives and zeros.

### 6.2 Relationship discovery

Run on the sample. A relationship is reported when it holds for at least
`DISCOVERY_MIN_HOLD = 97%` of applicable rows and is not trivial.

| Kind | Example | Trivial cases excluded |
| --- | --- | --- |
| Dependency A → B | `vendor_id` → `vendor_name` | A is unique (holds by definition), B is constant |
| Date order | `doc_date <= post_date` | identical columns |
| Conditional completeness | `status = Closed` ⇔ `close_date` is filled | B always filled or always blank |
| Arithmetic | `net + tax = gross` (tolerance 0.01) | only searched when there are at most 15 measure columns |

A relationship that holds for 99% of rows is valuable precisely because of the
remaining 1%. Those rows are the exceptions the auditor needs to see.

Discovery carries the hold rate and the number of rows checked, so both AI and
the auditor can judge it.

## 7. Template catalog

### 7.1 Template interface

```ts
type TemplateId = string; // e.g. "completeness.blank"

interface TestTemplate<P> {
  id: TemplateId;
  title: string;                 // "Blank values"
  dimension: "completeness" | "validity" | "uniqueness" | "accuracy" | "consistency";
  kind: "standard" | "rule";     // rule templates express a hypothesis, see 7.4
  /** Plain-language sentence shown to the auditor, generated from the parameters. */
  describe(params: P): string;
  /** Instances created automatically from the profile (standard plan). */
  autoInstances(profile: DatasetProfile): TestDefinition<P>[];
  /** Rejects unknown columns, wrong column types and invalid values. */
  validate(params: P, profile: DatasetProfile): ValidationError[];
  run(data: Dataset, params: P, ctx: RunContext): TestResult;
  /** Which detail screen opens from a result card. */
  detailView: "pattern" | "records" | "distribution";
}

type TestDefinition<P = unknown> = {
  id: string;
  template: TemplateId;
  params: P;
  source: "standard" | "discovered" | "ai" | "auditor";
  reason: string;                // why this test is in the plan, in plain language
  tag?: "data_quality" | "potential_exception";
  enabled: boolean;
};
```

### 7.2 Catalog v1

| Template | Parameters | Applies to | Filled automatically by code |
| --- | --- | --- | --- |
| `completeness.blank` | column, threshold % | all | every column |
| `completeness.placeholder` | column, values (`N/A`, `0`, `9999-12-31`, `1900-01-01`, `TBD`, `-`) | all | every column; AI may add values |
| `validity.type` | column, expected type, date format | measure, date, boolean | every typed column |
| `validity.pattern` | column, group column, threshold % | identifier, category, free_text | existing pattern engine verdicts |
| `validity.allowed_values` | column, allowed values | category | case/space/punctuation variants only (`EUR` / `Eur` / `EUR `); full list from AI |
| `validity.range` | column, min, max | measure, date | negatives in amounts, future dates, years before 1990; business ranges from AI |
| `uniqueness.key` | column(s) | identifier | single identifier columns with uniqueness ≥ 99%; composite keys from AI |
| `uniqueness.row` | — | dataset | always |
| `accuracy.outlier` | column, method (IQR / MAD) | measure | every measure column |
| `accuracy.calendar` | column, weekends | date | posting and document dates (holidays later) |
| `rule.compare` | column A, operator, column B | measure, date | from discovery (date order) |
| `rule.conditional` | if: column + condition, then: column + condition | all | from discovery (conditional completeness) |
| `rule.dependency` | column A, column B | identifier/category | from discovery |
| `rule.arithmetic` | columns, formula kind, tolerance | measure | from discovery |

Conditional operators: `empty`, `not_empty`, `eq`, `neq`, `in`, `not_in`, `gt`,
`gte`, `lt`, `lte`. Comparisons take a constant or another column.

The existing pattern engine becomes `validity.pattern` without behaviour change.
Its tests (`data-quality.test.mjs`, `data-quality-robustness.test.mjs`) keep
passing.

### 7.3 Example definitions

```json
[
  {
    "template": "rule.conditional",
    "params": {
      "if":   { "column": "close_date", "op": "not_empty" },
      "then": { "column": "status", "op": "in", "values": ["Closed", "Completed"] }
    },
    "source": "ai",
    "tag": "potential_exception",
    "reason": "Records with a close date are expected to be closed."
  },
  {
    "template": "rule.dependency",
    "params": { "from": "vendor_id", "to": "vendor_name" },
    "source": "discovered",
    "tag": "data_quality",
    "reason": "The same vendor number should not appear with different names (holds for 99.2% of rows)."
  }
]
```

`tag` separates "the data is unreliable" from "this may be a process exception
worth examining in fieldwork". A close date on an open record can be either.
Fieldwork integration is out of scope, but the tag is recorded from day one.

### 7.4 Rule tests: is the data wrong, or the rule?

Rule templates test a hypothesis made from a sample (by discovery or by AI). If a
rule fails for 40% of rows, the rule is most likely wrong, not the data.
Showing that as "40% of records are wrong" would destroy trust in the tool.

Rule results are classified by violation rate:

| Violation rate | Classification | Shown as |
| --- | --- | --- |
| ≤ 5% | `finding` | Rule holds; these records are exceptions. |
| 5–30% | `uncertain` | Is this rule really valid? Auditor to confirm or ask the client. |
| > 30% | `rule_did_not_hold` | Not a finding. Listed separately as "assumption did not hold". |

The bounds are configurable defaults. Standard templates are not classified
this way; they measure a property directly.

## 8. Severity (code)

Every result card gets a deterministic severity using the existing
`Priority` scale (`high` / `medium` / `low` / `clean`):

```
score = rate band × template weight × column role weight
```

- **Rate band:** share of affected records (0 / < 1% / 1–5% / 5–20% / > 20%).
- **Template weight:** e.g. duplicate keys and type errors weigh more than
  outliers.
- **Column role weight:** amounts, identifiers and key dates weigh more than
  descriptions. Without AI the technical type is used; with AI the semantic role.

AI #2 may raise or lower a severity, but must state why. Both values are stored
and the UI shows when AI changed one.

Phase 1 implementation: rate bands score 1–4, template weights are 3 (wrong
type, duplicate keys), 2 (blanks, placeholders, range, duplicate rows) or 1
(spelling, outliers, weekend dates), type weights 1.5 (identifier, number), 1.25
(date), 1 (category, yes/no) or 0.5 (text, empty). A score ≥ 6 is high, ≥ 3
medium. Blank values within the blank tolerance are at most low. The pattern
test keeps its existing priority rules.

Without AI the run gets a code verdict that grades the findings, not the data's
fitness for use: **Significant issues** (any high), **Issues to review** (any
finding) or **No issues found**.

## 9. AI stage 1 — test plan

### 9.1 Input

Built in the browser by `payload.ts`, sent to the backend, which renders the
prompt and calls the configured provider through `llm/router.py`.

- Dataset name, row and column counts.
- Per column: name, technical type, blank %, distinct count, top values, rare
  values, pattern summary, date format, min/max. Values are truncated to 40
  characters.
- Discovered relationships with hold rates.
- The standard plan (so AI tunes it rather than repeating it).
- Audit context from planning: title, objectives, key risks. This lets AI tailor
  rules to the audit (a procurement audit puts vendor and invoice rules first).
- Optional sample: 30 **random** rows (exports are often sorted, so the first
  rows are not representative), subject to the sample setting (section 12).

Budget: roughly 100–150 tokens per column. Very wide datasets (> 150 columns)
send the columns with the most signal first and say so.

### 9.2 Output

Strict JSON:

```json
{
  "columns": [
    { "column": "BUDAT", "role": "posting_date", "label": "Posting date", "confidence": "high" }
  ],
  "parameter_changes": [
    { "test_id": "range:WRBTR", "params": { "min": 0 }, "reason": "..." }
  ],
  "drop_tests": [
    { "test_id": "outlier:ZIP", "reason": "Postal codes are numbers but not measures." }
  ],
  "new_tests": [ /* TestDefinition objects with source "ai" */ ],
  "not_testable": [
    { "idea": "Same vendor, same amount within 3 days", "reason": "No template; suggest for fieldwork." }
  ]
}
```

Semantic roles (closed list, `other` allowed): `record_id`, `document_number`,
`party_id`, `party_name`, `amount`, `quantity`, `unit_price`, `currency`,
`document_date`, `posting_date`, `due_date`, `close_date`, `status`, `country`,
`cost_center`, `account`, `user`, `description`, `other`.

### 9.3 Validation and safety

- Every proposed test goes through `template.validate`. Invalid proposals are
  dropped and listed in the log with the reason; they never reach the run.
- Unknown templates, unknown columns and type mismatches are rejected.
- Data values are placed in the prompt as delimited JSON and declared untrusted.
  Because the only effect of the output is a list of validated test definitions
  that the auditor reviews, a manipulated response can at worst propose useless
  tests. It cannot run code, read files or send data anywhere.
- One retry on malformed JSON; then the run continues with the standard plan and
  the AI node shows the error.

## 10. AI stage 2 — interpretation

### 10.1 Input

The result summary only: per result card the template, subject, records tested,
exceptions, rate, classification, code severity, up to three example values
(subject to the sample setting) and the relevant profile excerpt. Plus column
roles and audit context. No rows.

### 10.2 Output

```json
{
  "overall": { "verdict": "usable_with_conditions", "summary": "..." },
  "cards": [
    {
      "card_id": "blank:due_date",
      "severity": "high",
      "severity_reason": "Due dates drive the ageing test in the plan.",
      "meaning": "Format is correct, but 52% of due dates are blank.",
      "action": "ask_client",
      "action_text": "Ask whether blank due dates are open items or missing from the extract."
    }
  ],
  "client_questions": ["..."],
  "limitations": ["..."]
}
```

`verdict`: `usable`, `usable_with_conditions`, `not_usable`.
`action`: `ask_client`, `exclude_records`, `document_limitation`,
`investigate_in_fieldwork`, `no_action`.

The client question list is likely to save the auditor the most time.

### 10.3 Number check

AI only receives numbers computed by code. Every `card_id` must exist. Every number
in the output text is checked against the numbers in the input (with rounding
tolerance). On a mismatch, retry once; if it persists, show the interpretation
with a visible warning on the affected card.

## 11. Run map

A KNIME-style flow built with `@xyflow/react`, reusing the audit map's node
styling. **The run map is the visual face of the run log:** every node is a log
step and clicking it shows that step's record. There is no separate log screen
for data quality.

### 11.1 Layout

```
[Source] → [Profile] → [Discovery] → [AI: plan] → [Auditor review]
                                                        │
      ┌──────────────┬──────────────┬──────────────┬────┴──────────┐
 [Blank values] [Format/Pattern] [Key uniqueness] [Outliers]  [Dataset rules]   … one node per test
   ⚠ 3 columns     ⚠ 2 columns      ✓ clean        ⚠ 1 column   ⚠ 1 finding · ? 1 uncertain
      └──────────────┴──────────────┴──────┬───────┴───────────────┘
                                     [Exceptions] → [AI: interpretation] → [Result]
```

- **One node per test template, not per column.** A test runs on every applicable
  column and the node shows the total ("ran on 38 columns, 3 with findings").
  The map stays at roughly 10–15 nodes regardless of dataset width.
- All rule tests (discovered, AI, auditor) share one **Dataset rules** node; its
  result cards are rules instead of columns.
- A template with no applicable column (no date columns → no calendar test) is
  shown grey as "not applicable", so the auditor also sees what was *not*
  tested and why.

### 11.2 Node types and states

- Visually distinct: ✦ AI, ⚙ code, 👤 auditor. The auditor sees at a glance
  where AI was involved.
- States: `pending`, `running`, `done`, `skipped` (AI off), `not_applicable`,
  `error`. Badges show counts.
- Edges carry information: clicking Profile → AI shows what was sent (payload
  summary, whether a sample was included and how it was masked, token count).

### 11.3 Click levels

1. **Node:** badge and short status.
2. **Side panel** (like the audit map's `DetailPanel`):
   - AI node: what it said (proposals with reasons), input/output summary,
     provider, model, tokens, duration.
   - Test node: per-column summary and a few example exceptions.
   - Auditor node: what was approved, removed, added or changed versus the
     proposal.
3. **"View details":** the full test result screen (section 12.2). Nothing large
   is squeezed into a popup.

### 11.4 History

The map shows one run. Earlier runs are reached from the run list (section 12.0),
each with its own map and results.

## 12. Screens

### 12.0 Run list

The Data Quality page opens on a list of completed runs, one card per run, plus a
**New run** button.

```
┌────────────────────────────────────────────────────────────┐
│ invoices_2026_Q3.csv                     ⚠ Usable with conditions │
│ 22 Nov 2026, 14:32 · 25,000 rows · 38 columns              │
│ 17 tests · 4 findings (2 high) · AI: plan + interpretation │
│ [Open]  [View file]  [View report]             [Delete run] │
└────────────────────────────────────────────────────────────┘
```

- Runs belong to the audit project they were created in. The list shows only
  that project's runs; another audit has its own list. Deleting the audit project
  deletes its runs, files and saved rules.

- The card shows the source file (name, size, rows, columns), the date, the
  number of tests and findings, the overall verdict and whether AI was used.
- **Open** shows the run map and every result screen straight from the saved
  run. Nothing has to be uploaded or run again.
- **View file** shows the saved source file as a scrollable, searchable table, so
  the auditor can check later what the data looked like, and lets them download
  the original CSV.
- **View report** opens the run's result report (section 12.3) with a
  **Download Markdown** button.
- **Delete run** removes the card completely (results, log steps, and the source
  file unless another run uses it) after a confirmation that says it cannot be
  undone. Typical use: the auditor did not like a run and wants to start over.
- Runs on the same file (same content hash) are marked as such; the file is
  stored once.

### 12.1 Start and plan review

- Load file → profile and discovery run immediately (seconds, no AI).
- Two clear actions: **Run standard tests** and **Create test plan with AI**. The
  default comes from settings; AI is unavailable (and explained) when no provider
  is configured, in demo mode, or when disabled by policy.
- The plan screen lists tests as plain sentences, grouped by dimension, each with
  its source label (Standard / Discovered / AI suggestion / Added by you), its
  reason and a toggle. Technical parameters sit behind "Edit".
- "Add rule" opens a form for rule templates (pick columns and conditions from
  dropdowns). This is how dataset-specific rules exist without AI.
- Ambiguous date formats are confirmed here.
- **Thresholds** (rule classification bounds, discovery hold rate, blank and
  pattern thresholds) are editable under "Advanced settings", pre-filled with the
  defaults from section 14. The values used are saved with the run and shown in
  its log.

### 12.2 Test result screen

One shared skeleton for every test, generalised from the current pattern screen,
which already has exactly this shape:

```
┌─ Blank values ─────────────────────────────────────────────────┐
│  [38 columns tested]  [3 with findings]  [12,480 records]      │
├──────────────────────┬─────────────────────────────────────────┤
│ ⚠ due_date   52%     │  due_date                               │
│ ⚠ po_number   8%     │  13,010 of 25,000 records blank          │
│ ⚠ cost_center 3%     │  detail view …                          │
│ ✓ 35 columns clean   │  [Export CSV]                           │
└──────────────────────┴─────────────────────────────────────────┘
```

- Top: KPIs. Left: result cards by severity, clean ones collapsed at the bottom.
  Right: detail of the selected card. With AI on, the card's interpretation and
  recommended action appear at the top of the detail.
- Detail views by `detailView`:
  - `pattern`: the existing pattern drill-down (`FindingDetail`), unchanged.
  - `records`: generic exception table with filtering, example records and CSV
    export. Most templates use this.
  - `distribution`: histogram with the outlier bounds, for `accuracy.outlier`.
- For rule tests, cards are rules, and `uncertain` / `rule_did_not_hold` cards are
  shown in their own sections.

### 12.3 Result report

The final node, and **View report** on the run card, open a readable report:
overall verdict, top issues with meaning and action, client questions,
limitations, and what was not tested. Without AI the same structure is filled
with template sentences.

The report is saved with the run and exported as Markdown only. Linking it to the
reporting phase is a later step.

## 13. Logging and audit trail

### 13.1 What is recorded

Every run records:

- Source file metadata: file name, size, row count, headers, content hash, and a
  reference to the stored copy (section 13.3).
- Settings used: AI mode, sample setting, thresholds.
- Each step with timestamps, status and duration:
  - code steps: templates, parameters, rows processed, exceptions found;
  - AI steps: reference to the agent run log entry;
  - auditor step: the diff between proposed and approved plan.
- Results: cards with counts, rates, classification, code and AI severity, and the
  first 20 exceptions per card. Full exception lists are not saved; they are
  rebuilt from the stored source file (section 13.3).
- AI interpretation, if any, and whether AI was used at all.

### 13.2 AI step logging

AI steps go through `AgentRunLogService` so they inherit its policies: metadata
always, full prompt/response only when enabled, hosted restrictions, retention
and redaction. If its agent-specific fields do not fit data quality runs, the
service is extended rather than bypassed.

### 13.3 Source file and reopening a run

- When a run completes, the browser gzips the source file and uploads it. The
  backend checks it is valid gzip, computes the SHA-256 of the uncompressed
  content and stores it as `files/<sha256>.csv.gz` (CSV typically shrinks 5–10×).
  A file used by several runs is stored once.
- Reopening a run shows the map and summaries from the saved record at once.
  The browser then downloads the stored file and re-executes the saved plan,
  which restores every exception record and the pattern drill-down. This is a
  local re-computation of the saved plan, not a new run: nothing is saved and no
  AI is called. If the re-computed totals differ from the saved ones (e.g. after
  an engine change), the run shows a warning.
- Because plan and data are both saved, a run can be re-executed later and must
  give identical results (same plan + same data = same results).
- **Delete source file** on a run card removes the stored copy but keeps the
  results, for confidential data the auditor does not want kept. The run then
  shows summaries only and says the file was removed.
- Deleting a run deletes its file too, unless another run uses it. AI step
  entries in the agent run log follow that log's own retention rules.

## 14. Settings and privacy

| Setting | Values | Default |
| --- | --- | --- |
| AI mode | `off`, `plan_only`, `full` | `full` when a provider is configured, otherwise `off` |
| Sample sent to AI | `none`, `masked`, `raw` | `masked` (letters → x, digits → 9, structure kept) |
| Rule classification bounds | percentages | 5% / 30% |
| Discovery minimum hold rate | percentage | 97% |

- `none` still works: names, statistics and discovered relationships are enough
  for most proposals.
- With Ollama, nothing leaves the machine regardless of the sample setting; the
  settings screen says so.
- **Hosted showcase is read-only for data quality.** No file upload exists in
  hosted mode, for anyone. Visitors can only open runs that already exist: run
  map, results, source file and report. They cannot create, re-run, interpret or
  delete runs, and cannot change thresholds. This keeps bots from generating runs,
  uploads or AI calls in bulk.
- Showcase runs are created by an admin from the sample files bundled with the
  application (`frontend/public/sample-data/`), never from the file picker.
- The backend enforces this, not only the UI: in hosted mode every data quality
  write (storing a file, creating or deleting a run or file) rejects anyone but an
  authenticated admin (`ensure_data_quality_write_allowed`). Phase 1
  implementation: the admin's stored file goes through the same file endpoint;
  the UI offers admins only the bundled samples, the backend does not check that
  the file is one of them.
- Source files are stored in local mode (uploads) and hosted mode (bundled
  samples only).
- Thresholds are defaults, editable per run (section 12.1).
- A project-level switch can force AI off for confidential data.

## 15. Code placement

Follows `docs/architecture.md`: the capability owns its prompts, schemas and
normalisation; `llm/` stays generic.

Phase 1 as implemented (later phases add `discovery.ts`, rule templates,
`payload.ts` and the backend prompt/service files):

```
frontend/src/features/data-quality/
  engine/
    types.ts                  shared contracts (template, test, result card, run)
    csv.ts                    parser (existing)
    patterns.ts               character-pattern engine (existing, unchanged)
    dates.ts                  date format detection and parsing
    profile.ts                column profile and technical types
    templates/
      registry.ts             explicit list of templates (no auto-discovery)
      common.ts               severity, result-card helpers
      completeness.ts         blank values, placeholder values
      validity.ts             wrong data type, inconsistent spelling, out of range
      pattern.ts              format / pattern (wraps patterns.ts)
      uniqueness.ts           duplicate keys, duplicate rows
      accuracy.ts             unusual amounts, weekend dates
    runner.ts                 standard plan, plan changes, runs a plan, verdict
    report.ts                 Markdown result report (template sentences)
    session.ts                step log, saved-run record, replay
    source.ts                 gzip, downloads, exception CSV
  map/                        run map model, canvas and side panel
  DataQualityScreen.tsx       run list / new run / run view
  RunList.tsx, NewRun.tsx, PlanReview.tsx, RunView.tsx
  TestResultScreen.tsx, RecordsDetail.tsx, FindingDetail.tsx (existing)
  SourceFileView.tsx, ReportView.tsx, api.ts, ui.tsx

backend/app/features/data_quality/
  models.py                   run record, source file metadata
  store.py                    runs and gzip source files per project
backend/app/api/data_quality.py
```

Backend endpoints (Phase 1 marked ✓):

```
✓ GET    /api/projects/{project_id}/data-quality/runs
✓ GET    /api/projects/{project_id}/data-quality/runs/{run_id}
✓ POST   /api/projects/{project_id}/data-quality/runs
✓ DELETE /api/projects/{project_id}/data-quality/runs/{run_id}
✓ POST   /api/projects/{project_id}/data-quality/files          body: gzip; returns content hash
✓ GET    /api/projects/{project_id}/data-quality/files/{content_hash}
✓ DELETE /api/projects/{project_id}/data-quality/files/{content_hash}
  POST   /api/projects/{project_id}/data-quality/plan           AI #1
  POST   /api/projects/{project_id}/data-quality/interpret      AI #2
  GET    /api/projects/{project_id}/data-quality/rules
  PUT    /api/projects/{project_id}/data-quality/rules
```

Storage:

```
projects/{project_slug}/data_quality/
  runs/{run_id}.json
  files/{content_hash}.csv.gz source files, stored once per content
  rules.json                  rules saved for reuse in this project
```

Phase 1 implementation: the runner runs on the page and yields to the browser
between templates, so the run map shows progress. Both samples (25k and 30k rows)
finish in under a second. Moving it to a Web Worker is deferred until large files
show a need; a worker would hold a second copy of the data.

## 16. Phases

Each phase ships something usable on its own.

**Phase 1 — Standard tests and run map (no AI)**
- Template interface, registry and runner.
- Profiler with technical types and date handling.
- Standard templates: blank, placeholder, type, pattern (moved), allowed-value
  variants, basic range, key and row uniqueness, outliers, calendar.
- Run map with code nodes; test result screen skeleton with `pattern` and
  `records` detail views.
- Run list with run cards, run and source file storage, "View file", and step
  log for code steps.
- Done when: `sample_invoices.csv` and `sample_materials.csv` surface their
  seeded issues; existing pattern tests pass unchanged; the new templates have
  their own seeded test file (`frontend/tests/data-quality-engine.test.mjs`).
  Extending the robustness battery to the new templates is still open.

**Phase 2 — Discovery and rules (still no AI)**
- Relationship discovery; rule templates; classification (finding / uncertain /
  did not hold); "Add rule" form; `distribution` detail view; saved project rules.
- Done when: seeded rule breaks in the samples are found via discovery alone.

**Phase 3 — AI test plan**
- AI #1 endpoint, prompt, validation; semantic roles; plan review screen with
  sources; AI nodes on the map; privacy settings; agent run logging.
- Provider contract fixture like the readiness review's.

**Phase 4 — AI interpretation and report**
- AI #2 endpoint; number check; adjusted severities; actions; client questions;
  result report; "Interpret with AI" on an existing run.

**Later**
- Rule library across projects; multi-file tests; analytics templates (time
  windows, fuzzy matching, Benford); holiday calendars; linking
  `potential_exception` results to fieldwork and the audit map.

## 17. Open questions

1. **Default thresholds.** Keep 5% / 30% for rule classification and 97% for
   discovery for now; validate against the sample datasets and real exports.
   Users can change them per run.
2. **Read traffic on the showcase.** Viewing runs and source files is still open
   to visitors. Cache them or add basic rate limiting if bots become a problem.

## 18. Decision log

| # | Decision | Reason |
| --- | --- | --- |
| D1 | AI does not write or run code. | An auditor cannot read the code, so AI's explanation could silently differ from what the code does; generated code has silent errors (string dates, `NaN`, decimal commas) and is never tested; data in the prompt could steer generated code (prompt injection); small local models write unreliable code; Python would need Pyodide or server-side data. Revisit only as a sandboxed, clearly labelled escape hatch. |
| D2 | Standard and dataset-specific tests are the same templates. | One engine, one result format, one screen; only the source differs. |
| D3 | AI sees profiles and summaries, not rows. | Constant cost regardless of size; minimal data exposure. |
| D4 | AI is optional and can be switched off per run, per project, or by policy. | Confidential data, demo mode, no provider; standard tests are complete without it. |
| D5 | The run map is the run log. | One place to see where AI worked, what it said, what ran and what came out. |
| D6 | One map node per test, not per column. | Keeps the map readable for wide datasets; per-column detail lives on the result screen. |
| D7 | Tests run in the browser. | No server-side data processing is needed; the existing engine and its tests are already there. The stored source file (D9) is a copy for reference, not an execution dependency. |
| D8 | Rule results are classified by violation rate. | A wrong hypothesis must not be presented as broken data. |
| D9 | Every completed run is kept as a card with its results and a compressed copy of the source file. | The auditor comes back later and sees everything, including what the data looked like, without re-uploading or re-running AI. Compression and storing each file once keep the project small; "Delete source file" covers confidential data. |
| D10 | Runs are scoped to the audit project and can be deleted completely. | Each audit is its own workspace; an unwanted run should not clutter it. |
| D11 | English only, including AI output. | Consistent with the application; no language setting to maintain. |
| D12 | The hosted showcase is read-only: no uploads, visitors only view runs an admin created from bundled sample files. | Prevents bots from flooding the server with uploads, runs and AI calls; enforced in the backend. |
| D13 | Thresholds have defaults and are editable per run. | Auditors need the defaults; experienced users and unusual datasets need control. |
| D14 | The result report is exported as Markdown and opened from the run card. | Simple first step; reporting-phase integration later. |
