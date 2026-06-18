# Context Awareness Architecture

AuditCopilot agents should not run as isolated prompt boxes. Audit work is connected: objectives drive risks, risks drive tests, tests create fieldwork, fieldwork can produce findings, and findings shape reporting. Context awareness gives each agent enough structured audit context to stay aligned with that workflow without sending the full project JSON on every run.

The current implementation keeps JSON storage, but separates storage access from graph/query/context logic so the same architecture can later work with SQLite, Postgres, or module-specific stores.

## Architecture

### AuditGraphService

`backend/app/services/audit_graph_service.py` builds a normalized graph view of the current project. It returns structured graph items and relationships rather than prompt text.

It normalizes relationships from:

- Planning hierarchy
- Fieldwork execution
- Document requests
- Interview mappings
- Findings
- Reporting
- Canvas edges
- Agent input/output edges

Graph methods include `get_item`, `get_items_by_type`, `get_related_items`, `get_upstream_items`, `get_downstream_items`, `get_items_by_phase`, `get_items_by_workstream`, `get_relationship_gaps`, `get_objective_chain`, `get_risk_chain`, `get_test_chain`, and `get_traceability_chain`.

### Semantic Relationships

Canvas edges are converted into semantic audit relationships where possible. If an edge has `relationship_type` or `relationshipType` in `edge.data`, that explicit value is used. Otherwise the graph infers from source and target item types.

| Source | Target | Relationship |
| --- | --- | --- |
| `audit` | `workstream` | `contains` |
| `workstream` | `objective` | `contains` |
| `objective` | `risk` | `contains` |
| `risk` | `test` | `contains` |
| `test` | `fieldwork_item` | `executed_as` |
| `test` | `document_request` | `requires_document` |
| `objective` / `risk` / `test` | `interview_question` | `clarified_by` |
| `fieldwork_item` | `finding` | `results_in` |
| `finding` | `report` | `reported_in` |
| `finding` | `executive-summary` | `summarized_in` |

When no semantic relationship can be inferred, the graph keeps `visual_edge` and marks the relationship metadata with `semantic=false`. Semantic relationships used by context traversal default to:

```text
contains, executed_as, requires_document, clarified_by, results_in, reported_in, summarized_in
```

Operational relationships such as `agent_input`, `agent_output`, and generic `visual_edge` are excluded from context traversal unless a recipe explicitly asks for them. Agent nodes are also excluded by default.

### Context Blocks

Context blocks live in `backend/app/context/blocks.py`. A block is a reusable provider for one piece of audit context. Blocks are registered through `ContextBlockRegistry`, so future modules can add blocks without changing the pack builder.

Current blocks include:

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

Every block returns structured content plus metadata: item count, summary mode, detail mode, notes, and truncation status.

### Traceability Chain

`traceability_chain` gives agents a stable view of the audit chain for selected items:

- Objective: objective -> risks -> tests -> fieldwork -> findings -> report sections
- Risk: risk -> tests -> fieldwork -> findings -> report sections
- Test: test -> fieldwork -> findings -> report sections

When interview questions are included, the chain also includes interview roles so agents know who each question is intended for.

### Context Recipes

Recipes live in `backend/app/context/recipes.py`. A recipe declares what context an agent needs:

- Blocks to include
- Relationship depth
- Direction
- Relationship types
- Excluded item types
- Max items per type
- Summary mode
- Detail mode
- Context/token budget

This keeps context logic out of individual agents. The agent runtime asks for a context pack by agent type, and the recipe determines blocks and limits.

Conceptually:

```text
Agent = Prompt + Context Recipe + Output Contract
```

There is also a future-facing `audit_quality_reviewer` recipe that uses workflow summaries, findings, reporting context, relationship gaps, and traceability chains.

### ContextPackBuilder

`backend/app/context/context_pack_builder.py` builds a structured context pack:

1. Load the agent recipe.
2. Build one normalized audit graph.
3. Execute registered context blocks with the same graph object.
4. Apply deterministic limits.
5. Render an LLM-friendly Markdown version.
6. Return structured blocks, summary, limits, and rendered text.

The structured pack is the source of truth. `rendered_context` is a prompt-ready representation for LLM calls and preview UI.

### Agent Runtime Integration

When an agent runs:

1. The backend resolves connected input cards.
2. `ContextPackBuilder` builds the agent-specific context pack.
3. `_agent_json` receives `rendered_context`, pack summary, and task-specific output instructions.
4. The LLM output is parsed and saved as before.
5. Lightweight context metadata is stored on `agent.last_output`.

Stored metadata includes recipe id, blocks used, selected item ids, estimated context tokens, truncation status, and fallback recipe status. Full rendered context is not stored.

### Context Preview

The preview endpoint returns a context pack without running the agent:

`POST /api/projects/{project_id}/agents/{agent_id}/context-preview`

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

If `selected_item_ids` is omitted, the backend uses cards connected into the agent. The frontend agent detail panel includes a `Preview context` button showing blocks, selected/related item counts, estimated tokens, truncation status, and rendered context.

## Cost Controls

The context builder applies deterministic controls:

- `max_context_tokens`
- `max_items_per_type`
- `relationship_depth`
- `relationship_types`
- `exclude_item_types`
- `summary_mode`: `compact`, `structured`, `detailed`
- `detail_mode`: `selected_full_related_summary`, `all_summary`, `full_with_limits`
- Truncation metadata on blocks and final pack limits

If final truncation is needed, the rendered context includes a clear marker and preserves the `Instructions for Context Use` section.

## Future Modules

Future modules should register new context blocks instead of adding prompt-specific traversal in agents.

Examples:

- Analytics Lab: `dataset_profile`, `analytics_results`, `analytics_opportunities`
- Data Quality: `data_quality_profile`, `data_quality_issues`, `dataset_warnings`
- Evidence/OCR: `evidence_summary`, `extracted_text_summary`, `evidence_sufficiency`
- Audit Quality: `completeness_score`, `weak_test_detection`, `relationship_gaps`

## Developer Guide

To add a context block:

1. Create a block provider in `backend/app/context/blocks.py` or a module context file.
2. Give it a stable `block_id`.
3. Implement `build(request)` and return `ContextBlock`.
4. Register it in `default_context_block_registry()` or a future module registry hook.
5. Add the block id to one or more recipes.

To add or update an agent recipe:

1. Add or update a `ContextRecipe` in `backend/app/context/recipes.py`.
2. Choose blocks based on the agent’s job.
3. Set relationship depth, direction, relationship types, and excluded item types.
4. Set item and token limits.
5. Use the context preview endpoint to inspect the result before changing prompts.

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
    "related_item_count": 8,
    "blocks": ["audit_overview", "workflow_state", "selected_items", "traceability_chain", "connected_items", "existing_outputs"],
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

## Audit Overview

```json
{ "...": "..." }
```

## Traceability Chain

```json
{ "...": "..." }
```

## Instructions for Context Use

Use this context to stay aligned with the audit scope.
Respect existing relationships between objectives, risks, tests, fieldwork items, findings, and report sections.
Avoid duplicating existing outputs.
If context is incomplete, say what is missing instead of inventing relationships.
````

## Design Principles

- Agents should not directly traverse raw project JSON.
- Context logic should be centralized and reusable.
- Storage access should remain separate from graph/query logic.
- Context packs should be structured first and text-rendered second.
- Canvas edges should become semantic audit relationships where possible.
- Context should be previewable before running an agent.
- Future modules should plug in through context blocks and recipes.
