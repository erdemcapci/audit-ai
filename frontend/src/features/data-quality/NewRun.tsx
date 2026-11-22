import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { dataQualityApi } from "./api";
import type { Dataset } from "./engine/csv";
import { buildProfile } from "./engine/profile";
import { buildStandardPlan } from "./engine/runner";
import { buildRecordContent, executeRun, readSource, type RunRecord } from "./engine/session";
import { gzip } from "./engine/source";
import { DEFAULT_SETTINGS, type DatasetProfile, type RunResults, type RunSettings, type TemplateId, type TestDefinition } from "./engine/types";
import { RunMap } from "./map/RunMap";
import { PlanReview } from "./PlanReview";
import { formatBytes, UploadIcon } from "./ui";

/** Sample files bundled with the app (frontend/public/sample-data). The only source in the hosted showcase. */
const SAMPLES = [
  { file: "sample_invoices.csv", title: "Invoices", text: "25,000 invoices with customer, tax number, date and amount." },
  { file: "sample_materials.csv", title: "Material master", text: "30,000 SAP-style materials from four source systems." }
];

export type RunCache = { record: RunRecord; data: Dataset; bytes: ArrayBuffer; results: RunResults };

type Loaded = { data: Dataset; bytes: ArrayBuffer; size: number; loadedAt: string; loadMs: number; profileMs: number };
type Stage = "choose" | "plan" | "running" | "saving" | "save_failed";

export function NewRun({ projectId, allowUpload, onCancel, onSaved }: { projectId: string; allowUpload: boolean; onCancel: () => void; onSaved: (cache: RunCache) => void }) {
  const [stage, setStage] = useState<Stage>("choose");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [standardPlan, setStandardPlan] = useState<TestDefinition[]>([]);
  const [plan, setPlan] = useState<TestDefinition[]>([]);
  const [reviewStartedAt, setReviewStartedAt] = useState("");
  const [progress, setProgress] = useState<Partial<Record<TemplateId, "running" | "done">>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const pending = useRef<(() => Promise<void>) | null>(null);

  async function load(read: () => Promise<{ bytes: ArrayBuffer; name: string }>) {
    setError("");
    setBusy("Reading the file…");
    try {
      const started = performance.now();
      const { bytes, name } = await read();
      const { data } = readSource(bytes, name);
      const loadMs = Math.round(performance.now() - started);
      const profileStarted = performance.now();
      const nextProfile = buildProfile(data, DEFAULT_SETTINGS);
      const nextPlan = buildStandardPlan(nextProfile, DEFAULT_SETTINGS);
      setLoaded({ data, bytes, size: bytes.byteLength, loadedAt: new Date().toISOString(), loadMs, profileMs: Math.round(performance.now() - profileStarted) });
      setSettings(DEFAULT_SETTINGS);
      setProfile(nextProfile);
      setStandardPlan(nextPlan);
      setPlan(nextPlan);
      setReviewStartedAt(new Date().toISOString());
      setStage("plan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to read the file.");
    } finally {
      setBusy("");
    }
  }

  const loadFile = (file: File) => load(async () => ({ bytes: await file.arrayBuffer(), name: file.name }));
  const loadSample = (file: string) => load(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}sample-data/${file}`);
    if (!response.ok) throw new Error("The sample file could not be loaded.");
    return { bytes: await response.arrayBuffer(), name: file };
  });

  /** Settings that change how columns are read rebuild the plan; tests the auditor switched off stay off. */
  function changeSettings(next: RunSettings) {
    if (!loaded) return;
    const nextProfile = buildProfile(loaded.data, next);
    const nextStandard = buildStandardPlan(nextProfile, next);
    const previous = new Map(plan.map((t) => [t.id, t]));
    setSettings(next);
    setProfile(nextProfile);
    setStandardPlan(nextStandard);
    setPlan(nextStandard.map((t) => {
      const old = previous.get(t.id);
      return old ? { ...t, enabled: old.enabled, params: t.template === "validity.pattern" ? old.params : t.params } : t;
    }));
  }

  async function run() {
    if (!loaded || !profile) return;
    setStage("running");
    setProgress({});
    setError("");
    try {
      const executed = await executeRun(loaded.data, profile, standardPlan, plan, settings,
        { loadedAt: loaded.loadedAt, loadMs: loaded.loadMs, profileMs: loaded.profileMs, reviewStartedAt },
        (template, state) => setProgress((p) => ({ ...p, [template]: state })));
      const save = async () => {
        setStage("saving");
        const stored = await dataQualityApi.uploadFile(projectId, await gzip(loaded.bytes));
        const content = buildRecordContent({
          source: { name: loaded.data.name, size: loaded.size, rows: loaded.data.rows.length, columns: loaded.data.headers.length, headers: loaded.data.headers, content_hash: stored.content_hash, stored: true },
          executed, plan, settings, createdAt: new Date().toISOString()
        });
        const record = await dataQualityApi.createRun(projectId, content);
        onSaved({ record, data: loaded.data, bytes: loaded.bytes, results: executed.results });
      };
      pending.current = save;
      await save();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The run could not be completed.");
      setStage(pending.current ? "save_failed" : "plan");
    }
  }

  async function retrySave() {
    if (!pending.current) return;
    setError("");
    try { await pending.current(); } catch (err) {
      setError(err instanceof Error ? err.message : "The run could not be saved.");
      setStage("save_failed");
    }
  }

  if (stage === "plan" && loaded && profile) {
    return (
      <>
        {error ? <div className="error-banner">{error}</div> : null}
        <PlanReview fileName={loaded.data.name} headers={loaded.data.headers} profile={profile} plan={plan} settings={settings}
          onPlanChange={setPlan} onSettingsChange={changeSettings} onRun={() => void run()} onCancel={onCancel} />
      </>
    );
  }

  if ((stage === "running" || stage === "saving" || stage === "save_failed") && loaded && profile) {
    const total = Object.keys(progress).length;
    const done = Object.values(progress).filter((s) => s === "done").length;
    return (
      <div className="dq-running">
        <div className="dq-section-head">
          <div>
            <h3>{stage === "running" ? `Running tests… ${done} of ${Math.max(total, done)} test types done` : stage === "saving" ? "Saving the run…" : "The run could not be saved"}</h3>
            <p className="muted dq-hint">{loaded.data.name} · {loaded.data.rows.length.toLocaleString()} rows · {formatBytes(loaded.size)}</p>
          </div>
          {stage === "save_failed" ? <div className="dq-file-bar"><button className="dq-btn" onClick={onCancel}>Discard</button><button className="dq-btn dq-btn-primary" onClick={() => void retrySave()}>Try saving again</button></div> : null}
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <RunMap input={{ fileName: loaded.data.name, rows: loaded.data.rows.length, columns: profile.columns, plan, tests: null, progress }} selected={null} onSelect={() => undefined} />
      </div>
    );
  }

  return <ChooseFile allowUpload={allowUpload} busy={busy} error={error} onFile={(f) => void loadFile(f)} onSample={(f) => void loadSample(f)} onCancel={onCancel} />;
}

function ChooseFile({ allowUpload, busy, error, onFile, onSample, onCancel }: { allowUpload: boolean; busy: string; error: string; onFile: (file: File) => void; onSample: (file: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); };
  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) onFile(file); };
  return (
    <div className="dq-choose">
      <div className="dq-section-head">
        <h3>New run</h3>
        <button className="dq-btn" onClick={onCancel}>Back to runs</button>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {busy ? <div className="dq-banner">{busy}</div> : null}
      {allowUpload ? (
        <div className={`dq-dropzone${dragging ? " dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
          <UploadIcon size={28} />
          <strong>Drop a CSV file here</strong>
          <span>Invoices, vendors, customers, journal entries, master data — Assurenodia reads each column and proposes the data quality tests that fit.</span>
          <button className="dq-btn dq-btn-primary" onClick={() => input.current?.click()} disabled={!!busy}>Choose file</button>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={pick} hidden />
        </div>
      ) : (
        <p className="muted dq-hint">File uploads are disabled in the hosted showcase. Runs can be created from the bundled sample files.</p>
      )}
      <div>
        <h4>{allowUpload ? "Or try a sample file" : "Sample files"}</h4>
        <div className="dq-samples">
          {SAMPLES.map((s) => (
            <button key={s.file} className="dq-sample" onClick={() => onSample(s.file)} disabled={!!busy}>
              <strong>{s.title}</strong>
              <span>{s.text}</span>
              <span className="dq-mono">{s.file}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
