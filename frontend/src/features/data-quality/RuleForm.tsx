import { useState } from "react";
import { isOrderable, ruleId, ruleLabel, ruleSentence, validateRule } from "./engine/rules";
import type { CompareOp, Condition, DatasetProfile, RuleParams, TestDefinition } from "./engine/types";

type Kind = RuleParams["kind"];

const KINDS: { kind: Kind; title: string; text: string }[] = [
  { kind: "compare", title: "Order", text: "One date or number should not come after another" },
  { kind: "conditional", title: "If … then …", text: "When one column has a value, another should too" },
  { kind: "dependency", title: "Same … same …", text: "The same number should always have the same name" },
  { kind: "arithmetic", title: "Calculation", text: "Two amounts should add up to or multiply to a third" }
];

const COMPARE_OPS: { op: CompareOp; label: string }[] = [
  { op: "lte", label: "on or before / at most" },
  { op: "lt", label: "before / less than" },
  { op: "eq", label: "equal to" },
  { op: "neq", label: "different from" },
  { op: "gte", label: "on or after / at least" },
  { op: "gt", label: "after / more than" }
];

const CONDITION_OPS: { op: Condition["op"]; label: string; needs: "none" | "value" | "values" | "ordered" }[] = [
  { op: "not_empty", label: "is filled in", needs: "none" },
  { op: "empty", label: "is blank", needs: "none" },
  { op: "eq", label: "is", needs: "value" },
  { op: "neq", label: "is not", needs: "value" },
  { op: "in", label: "is one of", needs: "values" },
  { op: "not_in", label: "is none of", needs: "values" },
  { op: "gt", label: "is after / more than", needs: "ordered" },
  { op: "gte", label: "is on or after / at least", needs: "ordered" },
  { op: "lt", label: "is before / less than", needs: "ordered" },
  { op: "lte", label: "is on or before / at most", needs: "ordered" }
];

/** The auditor adds a rule from dropdowns; it runs with the same template as discovered rules. */
export function RuleForm({ profile, existingIds, onAdd, onCancel }: { profile: DatasetProfile; existingIds: Set<string>; onAdd: (rule: TestDefinition<RuleParams>) => void; onCancel: () => void }) {
  const names = profile.columns.map((c) => c.name);
  const orderable = profile.columns.filter(isOrderable).map((c) => c.name);
  const measures = profile.columns.filter((c) => c.type === "measure").map((c) => c.name);
  const [kind, setKind] = useState<Kind>("conditional");
  const [compare, setCompare] = useState({ left: orderable[0] ?? "", op: "lte" as CompareOp, right: orderable[1] ?? "" });
  const [when, setWhen] = useState<Condition>({ column: names[0] ?? "", op: "eq", value: "" });
  const [then, setThen] = useState<Condition>({ column: names[1] ?? "", op: "not_empty" });
  const [dependency, setDependency] = useState({ from: names[0] ?? "", to: names[1] ?? "" });
  const [arithmetic, setArithmetic] = useState({ formula: "sum" as "sum" | "product", a: measures[0] ?? "", b: measures[1] ?? "", result: measures[2] ?? "", tolerance: "0.01" });

  const rule: RuleParams =
    kind === "compare" ? { kind, ...compare }
    : kind === "conditional" ? { kind, if: when, then }
    : kind === "dependency" ? { kind, ...dependency }
    : { kind, formula: arithmetic.formula, inputs: [arithmetic.a, arithmetic.b], result: arithmetic.result, tolerance: Number(arithmetic.tolerance) };
  const errors = validateRule(rule, profile);
  const duplicate = existingIds.has(ruleId(rule));

  const add = () => {
    if (errors.length || duplicate) return;
    onAdd({ id: ruleId(rule), template: "rule", subject: ruleLabel(rule), params: rule, source: "auditor", reason: "Added by you.", enabled: true });
  };

  return (
    <div className="dq-rule-form">
      <div className="dq-rule-kinds" role="radiogroup" aria-label="Kind of rule">
        {KINDS.map((k) => (
          <button key={k.kind} role="radio" aria-checked={kind === k.kind} className={kind === k.kind ? "active" : ""} onClick={() => setKind(k.kind)}>
            <strong>{k.title}</strong><span>{k.text}</span>
          </button>
        ))}
      </div>

      {kind === "compare" ? (
        <div className="dq-rule-row">
          <ColumnSelect value={compare.left} options={orderable} onChange={(left) => setCompare({ ...compare, left })} label="First column" />
          <span>should be</span>
          <select value={compare.op} onChange={(e) => setCompare({ ...compare, op: e.target.value as CompareOp })} aria-label="Comparison">
            {COMPARE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
          </select>
          <ColumnSelect value={compare.right} options={orderable} onChange={(right) => setCompare({ ...compare, right })} label="Second column" />
        </div>
      ) : null}

      {kind === "conditional" ? (
        <>
          <ConditionRow label="When" condition={when} names={names} onChange={setWhen} />
          <ConditionRow label="then" condition={then} names={names} onChange={setThen} />
        </>
      ) : null}

      {kind === "dependency" ? (
        <div className="dq-rule-row">
          <span>Each</span>
          <ColumnSelect value={dependency.from} options={names} onChange={(from) => setDependency({ ...dependency, from })} label="Column" />
          <span>should always come with the same</span>
          <ColumnSelect value={dependency.to} options={names} onChange={(to) => setDependency({ ...dependency, to })} label="Column" />
        </div>
      ) : null}

      {kind === "arithmetic" ? (
        <div className="dq-rule-row">
          <ColumnSelect value={arithmetic.a} options={measures} onChange={(a) => setArithmetic({ ...arithmetic, a })} label="First amount" />
          <select value={arithmetic.formula} onChange={(e) => setArithmetic({ ...arithmetic, formula: e.target.value as "sum" | "product" })} aria-label="Operation">
            <option value="sum">+</option>
            <option value="product">×</option>
          </select>
          <ColumnSelect value={arithmetic.b} options={measures} onChange={(b) => setArithmetic({ ...arithmetic, b })} label="Second amount" />
          <span>=</span>
          <ColumnSelect value={arithmetic.result} options={measures} onChange={(result) => setArithmetic({ ...arithmetic, result })} label="Result" />
          <label className="dq-inline-field">± <input type="number" min={0} step={0.01} value={arithmetic.tolerance} onChange={(e) => setArithmetic({ ...arithmetic, tolerance: e.target.value })} aria-label="Tolerance" /></label>
        </div>
      ) : null}

      <p className="dq-rule-preview">{errors.length ? <span className="dq-error-text">{errors[0]}</span> : duplicate ? <span className="dq-error-text">This rule is already in the plan.</span> : <>Rule: {ruleSentence(rule, profile)}</>}</p>
      <div className="dq-run-actions">
        <button className="dq-btn dq-btn-primary" onClick={add} disabled={errors.length > 0 || duplicate}>Add rule</button>
        <button className="dq-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ColumnSelect({ value, options, onChange, label }: { value: string; options: string[]; onChange: (value: string) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {!options.includes(value) ? <option value="">Choose a column</option> : null}
      {options.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  );
}

function ConditionRow({ label, condition, names, onChange }: { label: string; condition: Condition; names: string[]; onChange: (condition: Condition) => void }) {
  const needs = CONDITION_OPS.find((o) => o.op === condition.op)?.needs ?? "none";
  return (
    <div className="dq-rule-row">
      <span className="dq-rule-word">{label}</span>
      <ColumnSelect value={condition.column} options={names} onChange={(column) => onChange({ ...condition, column })} label={`${label} column`} />
      <select value={condition.op} onChange={(e) => onChange({ column: condition.column, op: e.target.value as Condition["op"], value: condition.value, values: condition.values })} aria-label={`${label} condition`}>
        {CONDITION_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      {needs === "value" || needs === "ordered" ? (
        <input value={condition.value ?? ""} onChange={(e) => onChange({ ...condition, value: e.target.value })} placeholder={needs === "ordered" ? "number, or date as yyyy-MM-dd" : "value"} aria-label={`${label} value`} />
      ) : null}
      {needs === "values" ? (
        <input value={(condition.values ?? []).join(", ")} onChange={(e) => onChange({ ...condition, values: e.target.value.split(",").map((v) => v.trim()) })} placeholder="values, separated by commas" aria-label={`${label} values`} />
      ) : null}
    </div>
  );
}
