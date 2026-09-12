# Architecture review and cleanup

Assessment made against `public/main` before refactoring. This is a structural
maintenance pass, not a change to product behavior.

## Assessment before changes

The FastAPI entrypoint registers small routers under `app/api`. Services own
JSON-backed audit workflows; `ProjectStore` coordinates their persisted models.
There is no database. `runtime.py` enforces hosted/local execution and write
policies. Provider implementations already share `llm/base.py` and `llm/router.py`.
The React app owns routing/project selection; `AuditWorkspace` coordinates map
editing, phase transitions, settings and logs. Generic controls are already
separate from screens and canvas nodes.

Existing natural boundaries are planning generation/approval, planning readiness,
fieldwork, findings, reporting/export, and audit-map agent execution. Context
construction, snapshots and logging support those workflows. They are not
specifications for hypothetical new product areas.

Concrete maintenance risks:

- `agent_service.py` has 1,610 lines mixing agent lifecycle, graph mutations,
  planning demo templates, report normalization and execution. Template or report
  changes require editing the same module as destructive map operations.
- `agents/prompts.py` combines planning, finding and report prompts. Agent classes
  and their services live in separate technical directories.
- Readiness owns 100 lines of the global 526-line model module, a 493-line service,
  two planning API routes, and much of the 440-line planning editor. Ownership is
  scattered despite having an independent scoring/review lifecycle.
- `agents/json_utils.py` is generic JSON extraction/parsing used by unrelated AI
  workflows. Conversely, audit context compaction and graph-aware context recipes
  are audit business behavior and must not move into generic LLM infrastructure.
- Fieldwork creation uses map sizing/layout and findings update fieldwork links.
  Reporting consumes multiple phases. These are real workflow dependencies, not
  accidental imports to remove mechanically.
- The 770-line workspace and 492-line detail panel coordinate shared map state.
  Moving that state without interaction coverage would be a regression risk.

## Readiness trace

`GET /api/projects/{project_id}/planning/readiness` calculates deterministic
readiness and reads the latest review/error. `POST .../readiness/ai-review` applies
the existing write/execution guards, selects demo or provider execution, normalizes
the result, and persists `planning_readiness.json`. The plan fingerprint detects
stale reviews. Project creation initializes this file; old projects tolerate its
absence. No readiness-specific environment variables exist: it uses the existing
global demo/provider configuration and runtime policy.

`PlanningScreen` loads readiness when project/planning changes, refreshes after
saving edits, and can invoke the review. `SHOW_AUDIT_PLAN_PAGE = false` currently
hides the page from workspace navigation. The page, API methods, models and CSS
are intentional and must remain intact. No exposure or new functionality is part
of this pass.

## Target and risk decisions

| Risk | Decision |
| --- | --- |
| Very low | Colocate existing phase services, agents, demos and prompt constants; relocate generic JSON parsing to `llm`; retain compatibility imports. |
| Low | Isolate readiness models/service/prompt rendering and frontend types/API/presentation; extract pure planning templates and report normalization; validate existing API and prompt contracts. |
| Moderate — defer | Split map-agent persistence/mutation orchestration, global audit graph/context policy, workspace state or detail-panel editing. These require broader interaction/deletion coverage first. |
| Do not change | Prompt wording/format behavior, provider requests/retries, model defaults, authentication, data formats, environment variables, navigation visibility; hypothetical modules, registries or plugin systems. |

## Cleanup classification

- **Safe to remove:** unused import bindings in touched modules, only after tracing
  references. Extracted implementations are relocated, not deleted functionality.
- **Suspicious / possibly unused — keep:** `documents/parser.py`, standalone
  `FieldworkScreen` and `ReportingScreen`, graph/context compatibility helpers and
  older service methods whose runtime use cannot be confidently excluded.
- **Intentional / future work — keep:** all Planning Readiness backend/frontend
  support, hidden Audit Plan navigation branch, styles and persisted data support.
- Phase-oriented AI endpoints remain registered, including ones used by the admin
  demo builder. They are not dead simply because canvas agents also generate content.

Baseline validation: 49 backend unittest tests passed; `npm run build` passed
(strict TypeScript checking and Vite production build). No backend static type or
lint configuration, frontend lint script, or frontend interaction test suite is
provided. Complete OpenAPI, prompt strings and agent definitions were captured
outside the repository for before/after comparison.

## Changes made and before/after

- Planning, findings and reporting now own their existing phase services, AI
  agents, prompts, deterministic demos and canvas agent definitions. Previously
  those implementations were scattered between `agents/` and `services/`.
- Readiness now owns its models, service and prompt renderer; the global model
  file re-exports the same classes for compatibility. There is no schema or data
  migration. The global model file went from 526 to 437 lines.
- Planning canvas templates and report normalization moved out of the agent
  coordinator, which went from 1,610 to 1,382 lines. Its existing methods still
  coordinate map changes; compatibility delegates preserve report helper entry
  points. No destructive graph operation was rewritten.
- The frontend planning editor went from 440 to 242 lines. Readiness now owns its
  response types, API, hook and presentation. The editor still mounts the hook and
  refreshes readiness after saving. The workspace changed only two imports.
- Generic JSON parsing moved unchanged into `llm/json_utils.py`; it was already
  reused, so this clarifies infrastructure ownership rather than introducing a
  second parser. The unchanged UTC helper moved to `time_utils.py` so independent
  readiness schemas do not import their compatibility facade and create a cycle.
- Provider clients were already centralized. No additional provider wrapper,
  retry mechanism, dependency or framework was introduced. The existing common
  audit system prompt remains audit-specific in `agents/prompt_defaults.py`.

## Meaningful relocations

All paths below are relative to `backend/app`, except the frontend rows. Old
service/agent/screen/API paths retain named compatibility exports.

| Previous owner | Implementation owner now |
| --- | --- |
| `services/planning_service.py`, planning agents | `features/planning/service.py`, `objectives_agent.py`, `risks_agent.py`, `tests_agent.py` |
| `services/planning_readiness_service.py`, readiness part of `models.py` | `features/planning_readiness/service.py`, `models.py`, `prompts.py` |
| `services/finding_service.py`, `agents/finding_agent.py` | `features/findings/service.py`, `agent.py` |
| `services/report_service.py`, `services/export_service.py`, `agents/report_agent.py` | `features/reporting/service.py`, `export.py`, `agent.py` |
| `agents/prompts.py`, `agents/demo_data.py` | Feature `prompts.py` / `demo.py`; shared audit instruction in `agents/prompt_defaults.py` |
| Definitions/templates/report normalization in `services/agent_service.py` | Feature `definitions.py`, `planning/canvas_templates.py`, `reporting/normalization.py` |
| `agents/json_utils.py`, `models.utc_now` | `llm/json_utils.py`, `time_utils.py` |
| Frontend `screens/PlanningScreen.tsx`, `api/planningApi.ts` | `src/features/planning/PlanningScreen.tsx`, `api.ts` |
| Readiness code embedded in frontend planning screen/API/global types | `src/features/planning-readiness/{PlanningReadinessPanel.tsx,usePlanningReadiness.ts,api.ts,types.ts}` |

## Deletions and retained code

No capability or meaningful implementation was deleted. Source bodies shown as
deletions at old paths were relocated. Confirmed unused imports removed were
`HTTPException` from `main.py`, `re` from the agent service after moving its
templates, and `FlowEdge`, `PlanningReadinessState`, `Risk`, `Test`, `Workstream`
from the relocated readiness service. These names had no uses in their owning
implementations and their model definitions remain available.

The old parser, standalone fieldwork/report screens, hidden readiness page and
CSS, context helpers, graph mutation helpers, public phase routes and compatibility
entry points were kept. The two Markdown renderers remain separate because their
arguments, fallbacks and treatment of existing Markdown differ. Similar planning
title helpers were not merged across capability boundaries.

## Audit Planning Readiness preservation

The functionality, supporting backend/frontend code, prompts, models/schemas,
configuration and dependencies all remain intact. The two endpoints and their
authorization behavior are unchanged. Persistence filenames/defaults, 65/35
weights, scoring, demo review, provider review, failure retention and stale-review
handling are preserved. No implementation was removed because it is hidden or
inactive. The navigation flag, labels and CSS are unchanged; no new readiness
functionality was added.

## Regression validation

- Before changes: 49 existing backend tests and frontend TypeScript/Vite build
  passed. Five workflow characterization tests were also made to pass against the
  original implementation before production code changed.
- After changes: 58 backend tests passed, covering phase and all six canvas agent
  workflows, linking/persistence/export, readiness success/staleness/failure,
  hosted access, JSON parsing, provider prompt capture and import boundaries.
- Complete generated OpenAPI, all original prompt constants and all six agent
  definitions are identical to the baseline. One hundred relocated/retained
  function, class and method bodies match the original Python AST exactly.
- All backend application modules import; Python compilation passes.
- `npm test` passes two frontend tests: exact rendered HTML fingerprints for seven
  readiness states and API endpoint/method/credential/error compatibility.
- Strict TypeScript checking and Vite production build pass. Browser harness code
  is included in TypeScript checking but not the production entrypoint.
- Safari displayed **PASS: 12 lifecycle checks** for initial load, planning/project
  changes, cancellation, review success/failure, saved-plan refresh and unmount.
  These used mocked API methods and no real audit data.
- `git diff --check` passes. No configured lint command or backend static type
  checker exists; compilation is not represented as static type checking.

Validation setup issues were resolved: initial characterization assumptions about
fieldwork mode/agent response keys were corrected against the unchanged backend;
the original demo Markdown behavior was retained. An initial build was invoked
from the repository root instead of `frontend` and was rerun correctly. The new
browser fixture needed the existing required `PlanningState.version` field. Vite's
test WebSocket listener was disabled for offline tests. Safari initially reported
a capture error, then its accessibility tree confirmed all lifecycle checks passed.
No unresolved test or build failures remain.

Limitations: paid/live providers were not invoked, Docker images were not built,
and a complete manual canvas interaction/deletion sweep was not performed.
Provider request implementations, runtime/configuration, storage implementation,
map/graph mutation bodies, navigation and styles were left unchanged. API tests
used temporary project directories; existing user projects were not modified.

## Remaining risks and recommended next steps

The agent coordinator, workspace and detail panel remain broad integration points.
Cross-phase graph deletion/layout, fieldwork linkage and audit-wide persistence
are intentionally still coupled. Global audit contracts and compatibility facades
also remain; this is an incremental boundary improvement, not total phase isolation.

Before extracting further canvas logic, add interaction and deletion/replacement
coverage that verifies linked fieldwork/findings and saved map state together.
Before changing older phase AI paths or consolidating report rendering, characterize
their existing live-provider formatting/fallback behavior separately. Review
compatibility facades only when all consumers are known. Add future workflow
directories only when their actual requirements exist; follow the
[architecture guide](../architecture.md).
