import { useState } from "react";
import type { RuntimeSettings } from "../../api/settingsApi";
import { NewRun, type RunCache } from "./NewRun";
import { RunList, type RunSection } from "./RunList";
import { RunView } from "./RunView";

type View = { kind: "list" } | { kind: "new" } | { kind: "run"; runId: string; section: RunSection };

/**
 * Data quality tests for one audit. Runs belong to the audit project. The hosted showcase is
 * read-only for visitors; an admin there can only create runs from the bundled sample files.
 */
export function DataQualityScreen({ projectId, runtime }: { projectId: string; runtime: RuntimeSettings | null }) {
  const hosted = runtime?.deploymentMode === "hosted";
  const canWrite = !hosted || Boolean(runtime?.isAdmin);
  const [view, setView] = useState<View>({ kind: "list" });
  const [cache, setCache] = useState<RunCache | null>(null);

  const showList = () => { setCache(null); setView({ kind: "list" }); };

  return (
    <section className="screen-panel dq-screen">
      <div className="screen-header">
        <div>
          <h2>Data Quality Tests</h2>
        </div>
      </div>
      {view.kind === "list" ? <RunList projectId={projectId} canWrite={canWrite} onNew={() => setView({ kind: "new" })} onOpen={(runId, section) => setView({ kind: "run", runId, section })} /> : null}
      {view.kind === "new" && canWrite ? (
        <NewRun projectId={projectId} allowUpload={!hosted} aiAvailable={Boolean(runtime?.agentExecutionEnabled)} onCancel={showList}
          onSaved={(saved) => { setCache(saved); setView({ kind: "run", runId: saved.record.id, section: "map" }); }} />
      ) : null}
      {view.kind === "run" ? (
        <RunView key={view.runId} projectId={projectId} runId={view.runId} initialSection={view.section}
          cache={cache?.record.id === view.runId ? cache : null} canWrite={canWrite} aiAvailable={Boolean(runtime?.agentExecutionEnabled)} onBack={showList} />
      ) : null}
    </section>
  );
}
