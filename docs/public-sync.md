# Synchronizing with the public AuditCopilot repository

The `main` branch of [erdemcapci/audit-ai](https://github.com/erdemcapci/audit-ai) is the source of truth for shared application behavior. The showcase must consume or directly port that implementation; it must not independently redesign shared UI.

## Files kept in parity

The following paths are shared application code and should be copied from public `main` when they change:

- `frontend/src/screens/AuditWorkspace.tsx`
- `frontend/src/panels/DetailPanel.tsx`
- `frontend/src/flow/**`
- the Canvas selectors in `frontend/src/styles/global.css`, including `canvas-workspace`, `canvas-overlay-inspector`, `canvas-overlay-close`, and `workspace-grid-map`

The Guided Audit Checklist, `AiAssistantPanel`, assistant right rail, and associated styles/utilities are intentionally absent. They must not be restored during synchronization.

`AuditWorkspace.tsx` may call the isolated `frontend/src/runtime/workspacePolicy.ts` adapter. Hosted policy must remain in that adapter rather than branching the Canvas, inspector, DetailPanel, or map interaction implementation.

## Files allowed to differ

Hosted deployment differences belong only in narrow configuration and integration surfaces:

- `frontend/src/runtime/**` for runtime-derived hosted UI policy
- `frontend/src/showcase/**` for legal, cookie, and usage information
- `frontend/src/App.tsx` and hosted authentication entry points
- `frontend/src/screens/StartScreen.tsx`, `SettingsScreen.tsx`, and `AdminScreen.tsx` for hosted access and administration
- `frontend/src/api/settingsApi.ts` for runtime configuration types and transport
- `backend/app/showcase/**` and backend runtime/auth/access-control adapters
- deployment, environment, and branding configuration such as Docker Compose, Dockerfiles, and Railway configuration

Allowed differences include deployment mode, AI execution restrictions and messages, provider/model visibility, authentication or anonymous-demo behavior, hosted access notices, and deployment branding. They do not include a different Canvas layout or interaction model.

## Update procedure

1. Fetch and check out the latest public `main` in a separate directory.
2. Review public commits affecting the shared paths above.
3. Copy or port those changes without reinterpretation.
4. Reapply only the call to `workspaceRuntimePolicy` if a public `AuditWorkspace.tsx` replacement removes it. Do not add hosted conditionals directly to shared Canvas components.
5. Confirm no public checklist removal is reversed.
6. Run `scripts/compare-public-shared.sh /path/to/audit-ai`. Any reported difference requires review; the runtime-policy call is the only expected integration seam in `AuditWorkspace.tsx`.
7. Run the frontend build, checklist/right-rail searches, and `git diff --check` before committing.
