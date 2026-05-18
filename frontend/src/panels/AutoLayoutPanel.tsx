import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { TextInput } from "../components/TextInput";
import type { AutoLayoutConfig } from "../types";

const DEFAULT_CONFIG: AutoLayoutConfig = {
  horizontal_gap: 620,
  vertical_gap: 50,
  card_width: 560,
  phase_gap: 160
};

const STORAGE_KEY = "auditcopilot.autoLayoutConfig";

export function AutoLayoutPanel({
  onApply,
  onCancel
}: {
  onApply: (config: AutoLayoutConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const initialConfig = useMemo(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  }, []);
  const [config, setConfig] = useState<AutoLayoutConfig>(initialConfig);
  const [busy, setBusy] = useState(false);

  function update(key: keyof AutoLayoutConfig, value: string) {
    setConfig((current) => ({ ...current, [key]: Number(value) }));
  }

  async function apply() {
    setBusy(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      await onApply(config);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="detail-panel">
      <div className="detail-kicker">Auto Layout</div>
      <h2>Layout configuration</h2>
      <p className="muted">
        Parents align with their first child. Additional child cards stack below, so objectives and risks expand vertically when they have many descendants.
      </p>
      <div className="detail-form">
        <TextInput
          label="Horizontal distance between levels"
          type="number"
          min={560}
          value={config.horizontal_gap}
          onChange={(event) => update("horizontal_gap", event.target.value)}
        />
        <TextInput
          label="Vertical distance between sibling cards"
          type="number"
          min={0}
          value={config.vertical_gap}
          onChange={(event) => update("vertical_gap", event.target.value)}
        />
        <TextInput
          label="Card width"
          type="number"
          min={560}
          value={config.card_width}
          onChange={(event) => update("card_width", event.target.value)}
        />
        <TextInput
          label="Distance between phase sections"
          type="number"
          min={0}
          value={config.phase_gap}
          onChange={(event) => update("phase_gap", event.target.value)}
        />
        <div className="button-row">
          <Button onClick={apply} disabled={busy}>{busy ? "Applying" : "Apply Auto Layout"}</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </aside>
  );
}
