# Application architecture

Assurenodia is a FastAPI/React application with local JSON project storage. This
guide describes existing code, not a roadmap of future product modules.

## Ownership

| Location | Responsibility |
| --- | --- |
| `backend/app/main.py`, `api/` | Application/router composition, existing HTTP contracts and request authorization. |
| `features/planning/` | Phase planning generation and approval/reopening, its three phase agents, prompts, demos, canvas definitions and planning output templates. |
| `features/planning_readiness/` | Readiness schemas, deterministic scoring, fingerprint/staleness logic, saved review/error handling and exact AI review prompt rendering. |
| `features/findings/` | Finding generation/refinement, persistence/link updates, prompt, demo and canvas definition. |
| `features/reporting/` | Report generation, Markdown export, report output normalization, prompt, demo and canvas definition. |
| `services/fieldwork_service.py` | Existing planning-to-fieldwork transition and layout coordination. |
| `services/agent_service.py` | Canvas agent lifecycle, context preparation, output application and graph mutations; explicit integration of current agent definitions. |
| `services/audit_map_service.py`, `audit_graph_service.py` | Audit-specific canvas layout and cross-phase graph projection/traversal. |
| `context/`, `agents/context_utils.py`, snapshot service | Audit-specific context policy, recipes, compaction and persisted context summaries. |
| `llm/` | Domain-agnostic provider interfaces/clients, provider selection and JSON response extraction. |
| `config.py`, `runtime.py` | Existing environment configuration and hosted/local access policy. |
| `store/file_store.py`, `time_utils.py` | Generic file I/O and UTC timestamp formatting. |
| `store/project_store.py`, `models.py` | Audit-wide persistence coordination and shared audit contracts. |
| `services/agent_run_log_service.py` | Current audit-agent execution logging and retention/policy support. |

The phase AI endpoints and configurable canvas agents are distinct existing
execution paths. The admin demo builder also calls phase services. Do not remove
one because the other exists, or merge their prompts, validation, context or error
behavior without a separately scoped behavior change.

On the frontend, `App.tsx` owns navigation and project selection.
`screens/AuditWorkspace.tsx` and `panels/DetailPanel.tsx` coordinate the audit map.
`features/planning/` owns the planning editor and API operations.
`features/planning-readiness/` owns readiness response types, its API calls,
`usePlanningReadiness` and `PlanningReadinessPanel`. The hook runs in the dedicated Readiness screen and the retained planning editor;
it refreshes on project/planning changes and after saving edits. The panel derives
a decision summary from the existing response and links findings to current map
cards through workspace selection, viewport focus and the existing detail panel.

`components/` contains generic controls. `api/client.ts` owns HTTP transport,
base URL, credentials and error handling. The remaining phase screens/APIs and
cross-phase TypeScript contracts retain their existing locations; no global state
framework or speculative frontend module system was introduced.

## Dependency rules

- Capability code calls generic infrastructure directly. `llm/` must not import
  concrete audit workflows, graph services, context recipes or project storage.
- Audit context and project persistence are audit-specific integration code, not a
  generic platform. Their knowledge of existing phase contracts is intentional.
- HTTP routers, the admin demo and the canvas agent coordinator compose workflows
  explicitly. No auto-discovery, service locator or plugin registration is needed.
- Keep business rules, output normalization and prompts with their owning
  capability. A similar helper in another workflow is not automatically shared:
  readiness title normalization and planning coverage matching have different
  owners; the two report Markdown renderers also have different contracts.
- Readiness schemas import only Pydantic, typing and the common timestamp helper.
  They must not import the global `models.py` facade or project storage, which
  would introduce a cycle.
- The old `app.agents.*` and `app.services.*_service.py` compatibility modules,
  the frontend `screens/PlanningScreen.tsx` facade, and the readiness re-exports
  in the global model/type files were removed once no application code imported
  them anymore. `frontend/src/api/planningApi.ts` remains as a thin re-export of
  `features/planning/api.ts`: `frontend/tests/planning-readiness.test.mjs` still
  imports it directly to assert old and new call sites resolve to the same
  function. Do not add business logic to a facade like this; if you remove its
  last consumer (including test consumers), remove the facade too.

## Prompts and AI execution

Each current feature owns `prompts.py`; planning, findings and reporting also own
their existing canvas `definitions.py`. The agent service explicitly combines
these definitions in their original order. This is the existing six-agent map,
not a framework for unknown capabilities.

`agents/prompt_defaults.py` retains the existing audit-wide system instruction.
It is deliberately audit-specific and is not part of provider infrastructure.
Readiness has its own complete prompt renderer. Review intentional prompt changes
with its provider-contract fixture; preserve JSON
serialization, provider options and normalization behavior during structural work.
Use `llm/router.py` for provider selection and `llm/json_utils.py` for the existing
JSON extraction/warning behavior. Provider-specific HTTP code remains separate;
do not invent generic retries or silently unify distinct request behavior.

## Adding an actual new workflow

Once a substantial workflow has real requirements, create its own feature
directory and place its logic, prompts, contracts and tests together. Connect it
through a small route module registered in `main.py` and an explicit frontend
integration point. Use existing configuration, HTTP transport, file I/O and LLM
clients where their current contracts fit. Keep new feature-specific types out of
the global model file unless they are genuinely shared audit contracts.

Start with ordinary functions/classes and direct imports. Add a shared helper
only when actual callers need the same domain-agnostic behavior. Do not create
empty domains, one-implementation interfaces, event buses, registries or a giant
`common` folder. Cross-phase persistence changes need workflow regression tests,
especially when deleting outputs or altering planning/fieldwork/finding links.

## Planning readiness and retained planning editor

Audit Planning Readiness remains implemented end to end. The planning router
registers both readiness routes:

```text
GET  /api/projects/{project_id}/planning/readiness
POST /api/projects/{project_id}/planning/readiness/ai-review
```

The GET route computes deterministic readiness and returns the latest saved AI
review or error; the POST route runs (or demo-simulates) a new AI review,
detects staleness from the plan fingerprint, and persists the result.
`ProjectStore` still creates, loads and saves `planning_readiness.json`,
including the missing-file fallback. Scoring, weights, review/error history,
stale detection, schemas, prompts, configuration, provider dependencies,
and backend contracts remain intact. The visible Readiness tab provides the
management summary, prioritized findings, recommendations and affected-card links.
`SHOW_AUDIT_PLAN_PAGE = false` still hides only the planning editor. Do not remove
the editor or its dependencies because it is hidden.

The summary preserves the backend overall score (65% deterministic / 35% AI).
Critical findings or a score below 55 mean Not ready; high-priority findings or a
score below 75 mean Needs attention. Remaining findings or a score below 90 mean
Ready with improvements; otherwise the result is Ready. Critical AI priorities
are treated as at least high priority. Missing or stale AI reviews show a clearly
labeled preliminary deterministic result. Stale AI findings remain in review
details and do not count toward current priorities. Findings are deduplicated by
normalized explanation and affected scope, then ordered by severity. No per-node
scores are introduced. Readiness does not approve the plan.

## Validation

From the repository root:

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
backend/.venv/bin/python -m compileall -q backend/app backend/tests
npm --prefix frontend test
npm --prefix frontend run build
```

The frontend tests use Node's test runner, React server rendering and the existing
Vite dependencies. They cover management decisions, scoring boundaries, priority
overrides, deduplication, stale/error states, links and API compatibility. The
readiness prompt fixture is checked using a fake provider. It includes explicit
internal-reference/display-label separation and a labeled artifact catalog.

For browser hook lifecycle checks, run the frontend dev server and open
`/tests/readiness-browser.html`. It runs 12 lifecycle assertions and 6 panel interaction assertions with mocked readiness API
methods, uses no backend and writes no audit data. It is a development test page,
not included in the production entrypoint. No backend static type checker or
lint configuration is currently supplied; Python compilation is not type checking.

For workspace UX checks, open `/tests/readiness-workspace-browser.html` in a real
browser at desktop widths of 1280px and 1440px. Results appear below the workspace.
Its 58 assertions exercise the actual workspace, canvas and inspector with an
isolated in-memory API: summary, finding navigation, unobscured viewport focus,
card editing, stale/preliminary states and reruns. No audit data is read or written.
Use real-time browser execution: accelerated virtual time can skip React Flow
layout/animation frames and produce misleading viewport failures.

Readiness narrative text is normalized in the backend using the plan's artifact
catalog. New reviews are normalized before persistence; GET and failure responses
also normalize old/current/stale reviews without migrating stored history. Only
display fields change: artifact IDs, navigation, fingerprints, scores and severity
remain intact. Unknown references use saved labels where reliable, otherwise a
neutral artifact-type label. The frontend never uses a raw ID as a card label.

Finding cards have one primary map action, collapsed Related plan items grouped
by actual node type, and Details retaining the full explanation/recommendation.
Concise text uses the existing deterministic check name or a bounded explanation
excerpt; there is no new AI call or response contract. Workstream ancestry supplies
affected areas, using the planning hierarchy first and supported map parent edges
as fallback. Context ancestors are labels only, never extra affected targets.

Explicit `affected_artifact_ids` remain the implicated set. The existing
`navigation.node_id` fallback is used only when that set is empty; it is not added
to a populated set. All targets are deduplicated and checked against the current
map. Missing references have no action and do not inflate counts. A single target
opens its inspector; multiple targets close overlays and fit the group with a
temporary tint. Zooming, panning and inspecting cards retain the highlighting. Clear highlights or
leaving Map dismisses it; Show all affected closes the inspector and refits the group.
Affected cards use a light tint and unrelated cards are dimmed, without an added
border or highlighting. This is workspace state and decorated-node CSS, never persisted map data.
Large groups can zoom farther out for an overview; individual inspection remains
available from Related plan items. Unit fixtures cover 1, 3, 6, 12 and 20 targets.

The management header emphasizes the AI review score and shows deterministic
checks separately. The existing blended score remains under Review details and
still contributes to the overall plan status with finding severity. Pending/stale
AI reviews show no current AI number; previous scores remain in review details.
This is a display change, not a change to scoring or readiness thresholds.

The score header now contains only AI and deterministic scores; management text
and the explanatory weighting paragraph are removed. Existing overall status and
combined scoring remain in Review details. AI findings may include `concise_issue`,
a plain-language problem statement produced by the same review call. Older saved
reviews omit this optional field and retain the explanation-excerpt fallback until
rerun. Full reasoning remains in Details; scoring and navigation are unchanged.
