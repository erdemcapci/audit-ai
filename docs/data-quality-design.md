# Data Quality Tests — Design

Status: Phase 1 (standard tests, run map, run storage), Phase 2 (relationship
discovery, dataset rules, saved rules) and Phase 3 (AI review of the test plan)
are implemented in `frontend/src/features/data-quality/` and
`backend/app/features/data_quality/`. Phase 4 (AI interpretation of results) is
design only. Where the implementation differs from the original design, the
section says so under "Phase 1/2/3 implementation".

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
2. **AI sees profiles, not the file.** AI receives column statistics, discovered
   relationships, result summaries and 30 sample rows as they are (no masking:
   the AI environment is treated as confidential, decision D15). Cost does not
   grow with the number of rows.
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

Phase 2 implementation (`engine/discovery.ts`, run inside `buildProfile`):

- The hold rate threshold is a run setting (`discoveryMinHoldPercent`, default 97).
- **Dependency:** A is an identifier or category whose values repeat (≥ 1.5 rows per
  value); B is an identifier, category, text or yes/no column whose most common
  value covers < 90% (otherwise it holds by chance). Checked on values of A seen at
  least twice, with ≥ 50 rows and ≥ 10 such values. A one-to-one pair (number ↔
  name) is proposed once, from the code-like column (identifier, else shorter
  values) to the descriptive one.
- **Date order:** pairs of date columns; skipped when > 90% of rows have the same
  date in both.
- **Conditional completeness**, both directions: `status = v ⇒ B filled in` (or
  blank) for category values with ≥ 30 rows, and `B filled in ⇒ status ∈ {v}`.
- **Arithmetic:** sums and products of two number columns (tolerance 0.01), at
  most 15 number columns; skipped when an input is (nearly) always 0 or 1.
- At most 8 relationships per kind, strongest first. Discovered rules holding for
  ≥ 99% of sampled rows are switched on; weaker ones are proposed switched off.
- On the bundled samples discovery finds `customer_id → country`,
  `tax_number → country` and `customer_id → tax_number` (the last one breaks on 72
  rows where the same customer's tax number is written differently), and
  `created_on ≤ last_changed_on` in the material master.

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

Phase 2 implementation: the four rule kinds are one template, `rule`, whose
params carry `kind: "compare" | "conditional" | "dependency" | "arithmetic"`. One
template keeps every rule on one map node and one result screen. Conditions
compare with constants only (column-to-column comparison is the `compare` kind).
Dates compare as dates in the column's own format, numbers as numbers, text
exactly (after trimming). A rule's id is `rule:<label>`, e.g.
`rule:vendor_id → vendor_name`, so the same rule found again or saved earlier is
recognised. The examples below use the original per-kind names.

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

Phase 2 implementation: a rule with no exceptions is classified `holds`. Only
`finding` cards count as findings (totals, verdict, map severity); the run totals
also count `uncertain` and `notHeld`. The result screen lists findings first, then
"To confirm" and "Did not hold" in their own sections; the report adds "Rules to
confirm" and "Assumptions that did not hold".

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
- Sample: 30 rows spread evenly over the file (exports are often sorted, so the
  first rows are not representative), values sent as they are.

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

**Phase 3 implementation**

- The AI review is optional and on request: the plan screen shows **Ask AI to
  review the plan** when AI is available (`agentExecutionEnabled`); without it
  the standard plan is used as before. There is no separate AI-mode setting.
- Request (`engine/aiPlan.ts` → `POST …/data-quality/plan`): file name, row count,
  per column name, type, blank %, distinct and unique %, top values, date format
  and decimal mark; discovered relationships as text; every proposed test as an
  id plus its plain sentence; 30 sample rows with values cut at 60 characters.
  The backend adds the audit context (title, description, process area, initial
  concern, objective and risk titles) and renders the prompt
  (`features/data_quality/prompts.py`).
- Response: `summary`, `columns` (role + plain meaning), `switch_off` and
  `switch_on` (existing test ids with a reason), `new_rules` (rule params in the
  rule-template shapes), `not_testable` (ideas for fieldwork). Parameter changes
  and new standard tests are not part of Phase 3.
- The backend keeps only what refers to this file and plan (known columns and
  test ids, closed role list, known rule kinds, at most 8 rules and 5 ideas). The
  browser validates each rule with `validateRule`; rules that do not fit are
  listed as "not used" with the reason and never run. A proposed rule already in
  the plan is switched on instead of duplicated.
- The plan shows AI changes with an "AI" note per test and an "AI suggestion"
  source label; **Discard AI suggestions** restores the plan from before the
  review. Changing settings rebuilds the plan and applies the same AI answer again.
- Column roles are shown (plan screen column overview, AI panel) but do not yet
  change severity weights.
- **Demo mode** answers with fixed rules instead of a model: roles guessed from
  column names (e.g. `BUDAT` → posting date), a "document number → party"
  dependency rule when both exist, batch-number keys switched off, and a
  duplicate-payment idea for fieldwork. It is labelled "Demo — fixed rules, no AI
  model" everywhere.
- Every review is logged through `AgentRunLogService` as agent "Data quality: AI
  test plan" (prompt and response when full logging is on), and the run records
  an `ai_plan` step with provider, model, token estimate, sample rows sent and
  counts of applied, rejected and proposed changes.

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
- What was sent to the AI (payload summary, sample rows, token estimate) is shown
  in the AI node's panel. Phase 3 implementation: edges carry no information of
  their own.

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
- The standard plan is shown first; **Ask AI to review the plan** is an extra step
  when AI is available (a provider is configured, or demo mode). Without it the
  button is not shown and nothing changes.
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
- Settings used: thresholds, date formats; whether and how AI reviewed the plan.
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
| Rule classification bounds | percentages | 5% / 30% |
| Discovery minimum hold rate | percentage | 97% |

- AI is used only when the auditor asks for it on the plan screen. Sample rows are
  sent as they are; there is no masking (D15). With Ollama nothing leaves the
  machine.
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

As implemented in Phases 1–3:

```
frontend/src/features/data-quality/
  engine/
    types.ts                  shared contracts (template, test, result card, run)
    csv.ts                    parser (existing)
    patterns.ts               character-pattern engine (existing, unchanged)
    dates.ts                  date format detection and parsing
    profile.ts                column profile and technical types
    discovery.ts              relationship discovery on the profile sample
    rules.ts                  rule comparison, labels, sentences, validation
    templates/
      registry.ts             explicit list of templates (no auto-discovery)
      common.ts               severity, result-card helpers
      completeness.ts         blank values, placeholder values
      validity.ts             wrong data type, inconsistent spelling, out of range
      pattern.ts              format / pattern (wraps patterns.ts)
      uniqueness.ts           duplicate keys, duplicate rows
      accuracy.ts             unusual amounts (with histogram), weekend dates
      rules.ts                dataset rules: the four kinds, classification
    runner.ts                 standard plan, plan changes, runs a plan, verdict
    report.ts                 Markdown result report (template sentences)
    session.ts                step log, saved-run record, replay
    aiPlan.ts                 AI review: request, applying and validating the answer
    source.ts                 gzip, downloads, exception CSV
  map/                        run map model, canvas and side panel
  DataQualityScreen.tsx       run list / new run / run view
  RunList.tsx, NewRun.tsx, PlanReview.tsx, RunView.tsx
  TestResultScreen.tsx, RecordsDetail.tsx, FindingDetail.tsx (existing)
  SourceFileView.tsx, ReportView.tsx, api.ts, ui.tsx
  RuleForm.tsx                "Add rule" form on the plan screen
  DistributionDetail.tsx      histogram for unusual amounts

backend/app/features/data_quality/
  models.py                   run record, source file metadata, saved rule
  store.py                    runs, gzip source files and saved rules per project
  prompts.py                  AI test plan prompt (audit context + file profile)
  ai_plan.py                  AI test plan: provider or demo answer, normalising, logging
backend/app/api/data_quality.py
```

Backend endpoints (implemented marked ✓):

```
✓ GET    /api/projects/{project_id}/data-quality/runs
✓ GET    /api/projects/{project_id}/data-quality/runs/{run_id}
✓ POST   /api/projects/{project_id}/data-quality/runs
✓ DELETE /api/projects/{project_id}/data-quality/runs/{run_id}
✓ POST   /api/projects/{project_id}/data-quality/files          body: gzip; returns content hash
✓ GET    /api/projects/{project_id}/data-quality/files/{content_hash}
✓ DELETE /api/projects/{project_id}/data-quality/files/{content_hash}
✓ GET    /api/projects/{project_id}/data-quality/rules
✓ PUT    /api/projects/{project_id}/data-quality/rules          replaces the list, one per id
✓ POST   /api/projects/{project_id}/data-quality/plan           AI #1; returns proposals, saves nothing
  POST   /api/projects/{project_id}/data-quality/interpret      AI #2
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

### 15.1 Any-file guarantees

The engine has to work on whatever CSV an auditor loads. What is guaranteed, and
checked by `frontend/tests/data-quality-any-file.test.mjs`:

- **It completes.** 150 random files per test run (random column mixes, junk
  values such as `1e999`, emoji, formulas, line breaks, odd and duplicate headers,
  all four delimiters, 1–3,000 rows, 1–40 columns) and degenerate shapes (one cell,
  one row, blank columns) run every test without an error, with consistent counts.
  `DQ_SEED` explores other random files.
- **One failing test never stops a run.** Each test runs in isolation; a failure is
  listed as "Could not run: …" in its template's notes. Relationship discovery
  failing leaves the standard tests untouched.
- **Numbers are read the way the export writes them.** The decimal mark is
  detected per column (`1.234,56` vs `1,234.56`); currency signs, spaces and
  apostrophes as thousands separators, accounting brackets `(500.00)` and SAP's
  trailing minus `500.00-` are understood; infinite values are not numbers.
- **Common export date formats:** ISO with or without time, `dd.MM.yyyy`,
  `dd/MM/yyyy`, `MM/dd/yyyy`, `dd-MM-yyyy`, `yyyy/MM/dd`, `15-Jan-2024`, SAP
  `yyyyMMdd` (years 1900–2100 only, so 8-digit identifiers stay identifiers) and
  two-digit years (`dd.MM.yy`, `dd/MM/yy`, `MM/dd/yy`, pivot at 50). Ambiguous
  day/month order is confirmed by the auditor.
- **Wide and large files stay within a browser tab.** Exception lists are capped at
  20,000 rows per result (counts stay complete); a completely blank column is one
  finding without a row list; discovery searches a capped number of candidate
  columns on very wide files and says so. Measured: 100,000 rows × 120 columns
  (81 MB) profile in ~4 s and run 407 tests in ~14 s; 300,000 rows × 30 columns in
  ~1 s and ~8 s. The page yields every 50 ms while tests run.

Known limits:

- **CSV only.** Excel files are recognised and the auditor is asked to save them as
  CSV; reading `.xlsx` directly would need a spreadsheet library.
- **Files up to 250 MB**, because everything runs in the browser tab.
- **Profiling is not interruptible:** on very wide files the page is busy for a few
  seconds while the columns are read; a notice with a spinner says so, and while
  tests run or a saved run reloads its file the page shows the same kind of notice.
- **Row numbers** count records after the header; blank lines inside a file are
  skipped, so after a blank line the numbers no longer match the text editor's
  line numbers.
- Number columns whose values all have the same number of digits (e.g. every
  quantity between 100 and 999) are read as codes, not amounts, so they get no
  outlier or range test.

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
- Done when: seeded rule breaks are found via discovery alone.
- Phase 2 implementation: the seeded rule breaks live in a synthetic test file
  (`frontend/tests/data-quality-rules.test.mjs`); the bundled samples were not
  changed, but discovery finds a real inconsistency in the invoices sample
  (customers with differently written tax numbers). Saved rules are proposed in
  later runs of the same audit when their columns exist and the rule is valid for
  the file; a discovered rule that was saved is marked "Saved rule".

**Phase 3 — AI test plan** (implemented)
- AI #1 endpoint, prompt, validation; semantic roles; plan review screen with
  sources; AI node on the map; agent run logging; demo mode.
- Phase 3 implementation: no privacy settings (D15, D16) and no provider contract
  fixture; the prompt is covered by backend tests instead.

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
| D15 | Sample rows go to the AI as they are, without masking. | The AI environment is treated as confidential; real values help the AI understand columns ("Closed" vs "Open"); less complexity. A masking option can be added if an external provider must not see values. |
| D16 | The AI review runs only when the auditor asks for it, and demo mode answers with fixed rules. | AI stays optional and visible; the showcase can show the AI step without a model. |
