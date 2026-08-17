import { FormEvent, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { LoadingState } from "../components/LoadingState";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";

export function StartScreen({
  onStart,
  onOpenExisting,
  onHome
}: {
  onStart: (payload: { title: string; description: string; process_area: string; initial_concern: string; extra_context: string }) => Promise<void>;
  onOpenExisting: () => void;
  onHome: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [processArea, setProcessArea] = useState("");
  const [initialConcern, setInitialConcern] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onStart({ title, description, process_area: processArea, initial_concern: initialConcern, extra_context: extraContext });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create audit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="start-screen">
      <section className="start-hero new-audit-page">
        <div>
          <p className="eyebrow">New workspace</p>
          <h1>Start a new audit</h1>
          <p className="hero-copy">
            Create a focused local audit workspace. Add the audit title and description, then move into the planning canvas.
          </p>
          <div className="button-row">
            <Button type="button" variant="ghost" onClick={onHome}>Home</Button>
            <Button type="button" variant="secondary" onClick={onOpenExisting}>Open Existing Audit</Button>
          </div>
        </div>
        <Card className="start-card">
          <form onSubmit={submit}>
            <TextInput label="Audit Title" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Procurement audit" />
            <TextArea
              label="Audit Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
              rows={5}
              placeholder="Review procurement controls from vendor onboarding through invoice approval."
            />
            <button type="button" className="optional-toggle" onClick={() => setShowOptional((value) => !value)}>
              {showOptional ? "Hide optional context" : "Add optional context"}
            </button>
            {showOptional ? (
              <div className="optional-fields">
                <TextInput label="Business / Process Area" value={processArea} onChange={(event) => setProcessArea(event.target.value)} />
                <TextInput label="Initial Concern" value={initialConcern} onChange={(event) => setInitialConcern(event.target.value)} />
                <TextArea label="Extra Context" value={extraContext} onChange={(event) => setExtraContext(event.target.value)} rows={3} />
              </div>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={busy || !title.trim() || !description.trim()}>
              {busy ? "Creating audit workspace" : "Create audit workspace"}
            </Button>
            {busy ? <LoadingState label="Creating local project files" /> : null}
          </form>
        </Card>
      </section>
    </main>
  );
}
