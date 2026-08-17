# Context Awareness

Assurenodia agents do not run as isolated prompt boxes. They receive structured audit context built from the current audit map, project files, and agent connections. The goal is transparency: a user should be able to understand what an agent knew, why it used that context, and how developers can extend the system without adding custom context collection code inside every agent.

The current architecture uses a hybrid model:

```text
Project JSON files
  -> AuditGraphService
  -> AuditContextSnapshotService
  -> ContextPackBuilder
  -> Agent run
```

This gives each agent two kinds of context:

- **Global Audit Knowledge**: a compact but meaningful whole-audit representation with actual audit item titles, descriptions, statuses, key fields, parent IDs, relationship gaps, and open items.
- **Current Task**: the agent, focus item references, parent hierarchy, existing outputs to avoid, task parameters, and output contract.

The snapshot service does not replace `ContextPackBuilder`. It feeds the `global_audit_knowledge` block. The legacy `audit_context_snapshot` block remains registered for compatibility, but default generation recipes use `global_audit_knowledge` and `current_task`.

## User View

When you run an agent, Assurenodia builds a context pack before it calls the language model. The default generation context includes:

- Global audit knowledge for broad awareness.
- Current task/focus references and parent hierarchy.
- Existing outputs to avoid.
- Relationship gaps and open items.
- A task-specific output contract.

The agent then receives:

- Its configured instructions.
- The context pack.
- A task-specific output contract, such as the JSON shape for risks or tests.

The app can log the final LLM input and output when full logging is enabled. Those logs are useful for checking exactly what the model received.

## Global Audit Knowledge

Global Audit Knowledge is backed by a compact, deterministic snapshot of the whole audit. It is stored separately from the main project data:

```text
PROJECTS_DIR/
  <project_slug>/
    audit_context_snapshot.json
```

The snapshot includes:

- Audit title, description, process area, initial concern, and extra context.
- Current audit status and inferred phase.
- Planning, workstream, objective, risk, and test summaries.
- Fieldwork, finding, and reporting summaries.
- Item counts by type.
- Relationship gap count and compact warnings.
- Key open items.
- Key completed items.
- Source sections used to build the snapshot.
- Generation mode, currently `deterministic`.
- Truncation and staleness flags.

The snapshot is intentionally compact, but it is not just counts. It includes actual item titles, short descriptions, statuses, key fields, child counts, and parent IDs so agents can understand the current audit state without receiving raw project trees.

Default generation prompts render this as:

```text
## Global Audit Knowledge
```

The block includes:

- Audit metadata.
- Current phase.
- Planning sections for workstreams, objectives, risks, and tests.
- Fieldwork, finding, and report summaries.
- Relationship gaps as compact item references.
- Snapshot staleness and truncation metadata.

## Current Task

The `current_task` block explains what the agent is doing now without repeating full audit item details already present in Global Audit Knowledge. It includes:

- Agent id, type, title, and config.
- Focus item references.
- Parent hierarchy references.
- Existing outputs to avoid.
- Missing focus item IDs, if any.
- A note that the exact output contract is provided in the LLM request.

The LLM request then appends:

```text
## Task Instruction
## Task Parameters
## Output Contract
```

Task parameters should reference audit objects by id/title/type whenever Global Audit Knowledge already contains the object details.

## Staleness

Each snapshot stores a `source_fingerprint`, computed from relevant project data:

- audit
- planning
- fieldwork
- findings
- report
- map edges

When the current fingerprint differs from the stored fingerprint, the snapshot is returned with:

```json
{
  "stale": true
}
```

A stale snapshot does not block agent runs. It means the audit changed since the snapshot was last rebuilt. Users or future UI controls can rebuild it before important runs.

## Snapshot API

Get the current snapshot:

```text
GET /api/projects/{project_id}/context-snapshot
```

If no snapshot exists, this returns `null`.

Rebuild the snapshot:

```text
POST /api/projects/{project_id}/context-snapshot/rebuild
```

The rebuild endpoint:

1. Loads project data.
2. Builds the normalized audit graph.
3. Produces a deterministic compact summary.
4. Saves `audit_context_snapshot.json`.
5. Returns the snapshot.

Example response shape:

```json
{
  "project_id": "audit_123",
  "generated_at": "2026-06-28T16:34:52Z",
  "source_updated_at": "2026-06-28T09:45:13Z",
  "source_fingerprint": "...",
  "stale": false,
  "summary_text": "Audit: Procurement Audit\nStatus/phase: planning / planning\n...",
  "structured_summary": {},
  "item_counts": {
    "audit": 1,
    "workstream": 2,
    "objective": 4
  },
  "relationship_gap_count": 5,
  "source_sections_used": ["audit", "planning_summary", "warnings"],
  "generation_mode": "deterministic",
  "truncated": false
}
```

## AuditGraphService

`backend/app/services/audit_graph_service.py` builds a normalized graph view of the current project. It turns project files and canvas edges into audit items and relationships.

It normalizes items from:

- Audit project data.
- Planning workstreams, objectives, risks, and tests.
- Fieldwork items.
- Findings.
- Report sections.
- Agent cards.

It normalizes relationships from:

- Planning hierarchy.
- Fieldwork execution.
- Findings.
- Reporting.
- Canvas edges.
- Agent input/output edges.

Core query methods include:

- `get_item`
- `get_items_by_type`
- `get_related_items`
- `get_upstream_items`
- `get_downstream_items`
- `get_items_by_phase`
- `get_items_by_workstream`
- `get_relationship_gaps`
- `get_objective_chain`
- `get_risk_chain`
- `get_test_chain`
- `get_traceability_chain`

Agents should not directly traverse raw project JSON. They should use context packs built from graph services and context blocks.

## Semantic Relationships

Canvas edges are converted into semantic audit relationships where possible. If an edge has `relationship_type` or `relationshipType` in `edge.data`, that explicit value is used. Otherwise the graph infers from source and target item types.

| Source | Target | Relationship |
| --- | --- | --- |
| `audit` | `workstream` | `contains` |
| `workstream` | `objective` | `contains` |
| `objective` | `risk` | `contains` |
| `risk` | `test` | `contains` |
| `test` | `fieldwork_item` | `executed_as` |
| `fieldwork_item` | `finding` | `results_in` |
| `finding` | `report` | `reported_in` |
| `finding` | `executive-summary` | `summarized_in` |

When no semantic relationship can be inferred, the graph keeps `visual_edge` and marks the relationship metadata with `semantic=false`.

Context traversal uses these semantic relationships by default:

```text
contains, executed_as, results_in, reported_in, summarized_in
```

Operational relationships such as `agent_input`, `agent_output`, and generic `visual_edge` are excluded unless a recipe explicitly asks for them. Agent nodes are excluded by default.

## Context Blocks

Context blocks live in `backend/app/context/blocks.py`. A block is a reusable provider for one piece of audit context. Blocks are registered through `ContextBlockRegistry`, so future modules can add context without changing the pack builder.

Current blocks include:

- `global_audit_knowledge`
- `current_task`
- `audit_context_snapshot`
- `audit_overview`
- `workflow_state`
- `selected_items`
- `connected_items`
- `upstream_items`
- `downstream_items`
- `existing_outputs`
- `relationship_gaps`
- `traceability_chain`
- `planning_summary`
- `fieldwork_summary`
- `findings_summary`
- `reporting_summary`

Every block returns:

- `block_id`
- `title`
- structured `content`
- metadata with item count, summary mode, detail mode, notes, and truncation status

### Global Knowledge Block

The default global block has:

```text
block_id = "global_audit_knowledge"
title = "Global Audit Knowledge"
```

It is built from `AuditContextSnapshotService` and includes:

- generated time
- stale flag
- `summary_text`
- item counts
- audit metadata
- planning, fieldwork, findings, and reporting summaries
- relationship gaps
- generation mode

Structured/full snapshot details are included only when a recipe requests structured/detailed modes. The compatibility block `audit_context_snapshot` remains registered with the same content model.

If the snapshot is stale, the block metadata includes a note:

```text
Snapshot stale: audit changed since last update.
```

If no snapshot exists, the block returns a clear missing message. The context pack still builds.

## Context Recipes

Recipes live in `backend/app/context/recipes.py`. A recipe declares what context an agent needs:

- Blocks to include.
- Relationship depth.
- Direction.
- Relationship types.
- Excluded item types.
- Max items per type.
- Summary mode.
- Detail mode.
- Context/token budget.

Conceptually:

```text
Agent = Prompt + Context Recipe + Output Contract
```

Default generation recipes use:

```text
global_audit_knowledge + current_task
```

Older granular blocks such as `selected_items`, `traceability_chain`, `connected_items`, `existing_outputs`, and `workflow_state` are still registered for compatibility and explicit preview/debug use, but they are no longer part of normal generation recipes because they duplicate objects already present in Global Audit Knowledge and Current Task.

This keeps context logic out of individual agents. Most future changes should update blocks or recipes, not each agent implementation.

## ContextPackBuilder

`backend/app/context/context_pack_builder.py` builds context packs:

1. Load the agent recipe.
2. Apply context options.
3. Build one normalized audit graph.
4. Execute registered context blocks with the same graph object.
5. Estimate tokens.
6. Truncate rendered context if needed.
7. Return structured blocks, summary, limits, and rendered text.

The structured pack is the source of truth. `rendered_context` is a prompt-ready Markdown representation for LLM calls and preview UI.

The builder continues working even if a block is missing or the snapshot is stale. Missing blocks are represented as structured warning blocks rather than exceptions.

## Agent Runtime Flow

When an agent runs:

1. The backend resolves connected input cards.
2. Invalid or stale explicit input IDs are filtered; if none are valid, saved graph connections are used.
3. `ContextPackBuilder` builds the agent-specific context pack.
4. Agent run logging starts, if enabled.
5. `_agent_json` receives:
   - system prompt
   - rendered context
   - task instruction
   - compact task parameters
   - task-specific output shape
6. The LLM output is parsed and saved into the appropriate project files.
7. Agent run logging stores metadata and optional full I/O.
8. The agent card stores lightweight context metadata in `last_output`.

Stored metadata includes:

- recipe id
- blocks used
- selected item ids
- estimated context tokens
- truncation status
- fallback recipe status

Full rendered context is not stored on the agent card. It is only stored in agent run logs when full I/O logging is enabled.

## Context Preview

The preview endpoint returns a context pack without running the agent:

```text
POST /api/projects/{project_id}/agents/{agent_id}/context-preview
```

Request:

```json
{
  "selected_item_ids": ["obj_123"],
  "context_options": {
    "relationship_depth": 2,
    "summary_mode": "compact"
  }
}
```

If `selected_item_ids` is omitted, the backend uses cards connected into the agent.

The preview response includes:

- context summary
- block list
- selected and related item counts
- estimated tokens
- truncation status
- rendered context

Use context preview before changing prompts or recipes.

## Cost Controls

The context builder applies deterministic controls:

- `max_context_tokens`
- `max_items_per_type`
- `relationship_depth`
- `relationship_types`
- `exclude_item_types`
- `summary_mode`: `compact`, `structured`, `detailed`
- `detail_mode`: `selected_full_related_summary`, `all_summary`, `full_with_limits`
- block truncation metadata
- final pack truncation metadata

If final truncation is needed, the rendered context includes a marker and preserves the `Instructions` section.

The snapshot also has its own compacting behavior:

- bounded section lists
- compact titles/descriptions/statuses
- gap summary counts
- `truncated=true` when the audit contains more items or gaps than the snapshot includes

## Developer Guide

### Add A Context Block

1. Create a provider in `backend/app/context/blocks.py` or a module-specific context file.
2. Give it a stable `block_id`.
3. Implement `build(request)` and return `ContextBlock`.
4. Register it in `default_context_block_registry()` or a future module registry hook.
5. Add the block id to one or more recipes.

Do not put storage traversal directly in agent prompts or individual agent run methods unless there is no reusable abstraction.

### Add Or Update A Recipe

1. Update `ContextRecipe` in `backend/app/context/recipes.py`.
2. Choose blocks based on the agent’s job.
3. Set relationship depth, direction, relationship types, and excluded item types.
4. Set item and token limits.
5. Use the context preview endpoint to inspect the result.
6. Run context tests.

### Add Snapshot Fields

Snapshot logic lives in:

```text
backend/app/services/audit_context_snapshot_service.py
```

When adding fields:

1. Keep the snapshot compact.
2. Prefer counts, titles, statuses, short descriptions, and warnings.
3. Avoid copying full raw project data.
4. Include new sections in `source_sections_used`.
5. Update tests in `backend/tests/test_audit_context_snapshot.py`.

### Staleness Rules

Staleness is fingerprint-based. If a new project file or data source should affect context, include it in `source_fingerprint()`.

For example, if evidence/OCR data is added later, its compact source data should be included in the fingerprint so snapshots become stale when evidence changes.

## Example Context Pack

```json
{
  "agent_id": "agent_test",
  "agent_type": "test_generator",
  "recipe_id": "test_generator_default",
  "context_summary": {
    "audit_title": "Procurement Audit",
    "phase": "planning",
    "selected_item_count": 1,
    "related_item_count": 0,
    "blocks": [
      "global_audit_knowledge",
      "current_task"
    ],
    "recipe_id": "test_generator_default",
    "fallback_recipe": false
  },
  "limits": {
    "max_context_tokens": 6000,
    "estimated_tokens": 2200,
    "truncated": false,
    "max_items_per_type": 20,
    "relationship_depth": 2,
    "summary_mode": "compact",
    "detail_mode": "selected_full_related_summary"
  }
}
```

Rendered excerpt:

````markdown
# Audit Context Pack

Agent: Test Generator (test_generator)
Recipe: test_generator_default

## Global Audit Knowledge

```json
{
  "stale": false,
  "summary_text": "Audit: Procurement Audit\nStatus/phase: planning / planning\n...",
  "planning": {
    "objective": {
      "items": [
        {"id": "obj_123", "type": "objective", "title": "Assess approval controls"}
      ]
    }
  }
}
```

## Current Task

```json
{
  "focus_items": [
    {
      "item": {"id": "risk_123", "type": "risk", "title": "Unauthorized approval override"},
      "parent_hierarchy": [
        {"id": "audit_123", "type": "audit", "title": "Procurement Audit"},
        {"id": "ws_123", "type": "workstream", "title": "Procurement Governance"}
      ]
    }
  ],
  "existing_outputs_to_avoid": {}
}
```

## Instructions

Use Global Audit Knowledge for broad audit awareness.
Use Current Task as the source of focus.
Avoid duplicates across the whole audit.
Respect existing hierarchy and relationships.
If context is incomplete, say what is missing instead of inventing relationships.
````

## Design Principles

- Agents should not directly traverse raw project JSON.
- Context logic should be centralized and reusable.
- Global Audit Knowledge and Current Task should complement each other.
- Each audit object should appear once in full detail whenever practical.
- Storage access should remain separate from graph/query logic.
- Context packs should be structured first and text-rendered second.
- Canvas edges should become semantic audit relationships where possible.
- Context should be previewable before running an agent.
- Stale context should be visible but should not block agent runs.
- Future modules should plug in through context blocks and recipes.
