import { isMissing } from "./csv";
import { parseDate } from "./dates";
import { parseAmount } from "./numbers";
import type { ColumnInfo, CompareOp, Condition, DatasetProfile, RuleParams } from "./types";

/*
 * Rules between columns: how values are compared, and how a rule reads as a label and as a sentence.
 * Dates compare as dates (in the column's own format), numbers as numbers, everything else as text.
 */

export const isOrderable = (info: ColumnInfo) => info.type === "date" || info.type === "measure";

/** Typed value for ordering comparisons, or null when blank or unreadable. */
export function orderedReader(info: ColumnInfo): (raw: string) => number | null {
  if (info.type === "date" && info.date) {
    const format = info.date.format;
    return (raw) => (isMissing(raw) ? null : parseDate(raw, format));
  }
  const decimal = info.measure?.decimal ?? ".";
  return (raw) => (isMissing(raw) ? null : parseAmount(raw, decimal));
}

/** A constant typed like the column: dates as yyyy-MM-dd, numbers in the column's decimal mark (or a dot). */
export function orderedConstant(info: ColumnInfo, value: string): number | null {
  if (info.type === "date") return parseDate(value, "yyyy-MM-dd");
  return parseAmount(value, info.measure?.decimal ?? ".") ?? parseAmount(value, ".");
}

export function compareValues(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case "lt": return a < b;
    case "lte": return a <= b;
    case "eq": return a === b;
    case "neq": return a !== b;
    case "gte": return a >= b;
    case "gt": return a > b;
  }
}

const sameText = (raw: string, value: string) => raw.trim() === value.trim();

/** True/false for a row, or null when an ordering comparison cannot be made (blank or unreadable value). */
export function evaluateCondition(condition: Condition, row: string[], info: ColumnInfo): boolean | null {
  const raw = row[info.index] ?? "";
  switch (condition.op) {
    case "empty": return isMissing(raw);
    case "not_empty": return !isMissing(raw);
    case "eq": return !isMissing(raw) && sameText(raw, condition.value ?? "");
    case "neq": return isMissing(raw) || !sameText(raw, condition.value ?? "");
    case "in": return !isMissing(raw) && (condition.values ?? []).some((v) => sameText(raw, v));
    case "not_in": return isMissing(raw) || !(condition.values ?? []).some((v) => sameText(raw, v));
    default: {
      const value = orderedReader(info)(raw);
      const constant = orderedConstant(info, condition.value ?? "");
      if (value === null || constant === null) return null;
      return compareValues(value, condition.op, constant);
    }
  }
}

export function ruleColumns(rule: RuleParams): string[] {
  switch (rule.kind) {
    case "compare": return [rule.left, rule.right];
    case "conditional": return [rule.if.column, rule.then.column];
    case "dependency": return [rule.from, rule.to];
    case "arithmetic": return [...rule.inputs, rule.result];
  }
}

const SYMBOL: Record<CompareOp, string> = { lt: "<", lte: "≤", eq: "=", neq: "≠", gte: "≥", gt: ">" };

function conditionLabel(c: Condition): string {
  switch (c.op) {
    case "empty": return `${c.column} blank`;
    case "not_empty": return `${c.column} filled`;
    case "in": return `${c.column} ∈ {${(c.values ?? []).join(", ")}}`;
    case "not_in": return `${c.column} ∉ {${(c.values ?? []).join(", ")}}`;
    default: return `${c.column} ${SYMBOL[c.op]} ${c.value ?? ""}`;
  }
}

/** Short label used as the rule's subject on cards and in the map. */
export function ruleLabel(rule: RuleParams): string {
  switch (rule.kind) {
    case "compare": return `${rule.left} ${SYMBOL[rule.op]} ${rule.right}`;
    case "conditional": return `${conditionLabel(rule.if)} ⇒ ${conditionLabel(rule.then)}`;
    case "dependency": return `${rule.from} → ${rule.to}`;
    case "arithmetic": return `${rule.inputs[0]} ${rule.formula === "sum" ? "+" : "×"} ${rule.inputs[1]} = ${rule.result}`;
  }
}

export const ruleId = (rule: RuleParams) => `rule:${ruleLabel(rule)}`;

const q = (value: string) => `“${value}”`;

function opWords(op: CompareOp, date: boolean): string {
  switch (op) {
    case "lt": return date ? "before" : "less than";
    case "lte": return date ? "on or before" : "at most";
    case "eq": return date ? "on the same day as" : "equal to";
    case "neq": return "different from";
    case "gte": return date ? "on or after" : "at least";
    case "gt": return date ? "after" : "more than";
  }
}

function conditionWords(c: Condition, profile: Pick<DatasetProfile, "columns"> | null, should: boolean): string {
  const date = profile?.columns.find((col) => col.name === c.column)?.type === "date";
  const be = should ? "should be" : "is";
  const list = (c.values ?? []).map(q).join(" or ");
  switch (c.op) {
    case "empty": return `${q(c.column)} ${be} blank`;
    case "not_empty": return `${q(c.column)} ${be} filled in`;
    case "eq": return `${q(c.column)} ${be} ${q(c.value ?? "")}`;
    case "neq": return `${q(c.column)} ${should ? "should not be" : "is not"} ${q(c.value ?? "")}`;
    case "in": return `${q(c.column)} ${be} ${(c.values ?? []).length > 1 ? "one of " : ""}${list}`;
    case "not_in": return `${q(c.column)} ${should ? "should not be" : "is not"} ${list}`;
    default: return `${q(c.column)} ${be} ${opWords(c.op, date)} ${c.value ?? ""}`;
  }
}

/** The rule as a plain-language sentence for the auditor. */
export function ruleSentence(rule: RuleParams, profile: Pick<DatasetProfile, "columns"> | null = null): string {
  switch (rule.kind) {
    case "compare": {
      const date = profile?.columns.find((c) => c.name === rule.left)?.type === "date";
      return `${q(rule.left)} should be ${opWords(rule.op, date)} ${q(rule.right)}.`;
    }
    case "conditional": return `When ${conditionWords(rule.if, profile, false)}, ${conditionWords(rule.then, profile, true)}.`;
    case "dependency": return `Each ${q(rule.from)} should always come with the same ${q(rule.to)}.`;
    case "arithmetic": return `${q(rule.inputs[0])} ${rule.formula === "sum" ? "+" : "×"} ${q(rule.inputs[1])} should equal ${q(rule.result)}.`;
  }
}

/** Problems that stop a rule from running on this file, in plain language. Empty when the rule is valid. */
export function validateRule(rule: RuleParams, profile: DatasetProfile): string[] {
  const errors: string[] = [];
  const column = (name: string) => profile.columns.find((c) => c.name === name);
  const missing = ruleColumns(rule).filter((name) => !name || !column(name));
  if (missing.length) return [missing.length === 1 ? "Choose a column that exists in this file." : "Choose columns that exist in this file."];
  switch (rule.kind) {
    case "compare": {
      const l = column(rule.left)!, r = column(rule.right)!;
      if (rule.left === rule.right) errors.push("Choose two different columns.");
      if (!isOrderable(l) || !isOrderable(r)) errors.push("Both columns must be dates or both must be numbers.");
      else if ((l.type === "date") !== (r.type === "date")) errors.push("A date column can only be compared with another date column.");
      break;
    }
    case "conditional":
      for (const c of [rule.if, rule.then]) {
        const info = column(c.column)!;
        if ((c.op === "eq" || c.op === "neq") && !c.value?.trim()) errors.push(`Enter the value for ${q(c.column)}.`);
        if ((c.op === "in" || c.op === "not_in") && !(c.values ?? []).some((v) => v.trim())) errors.push(`Enter at least one value for ${q(c.column)}.`);
        if (["gt", "gte", "lt", "lte"].includes(c.op)) {
          if (!isOrderable(info)) errors.push(`${q(c.column)} is not a date or number column, so it cannot be compared by size.`);
          else if (orderedConstant(info, c.value ?? "") === null) errors.push(info.type === "date" ? `Enter the date for ${q(c.column)} as yyyy-MM-dd.` : `Enter a number for ${q(c.column)}.`);
        }
      }
      if (rule.if.column === rule.then.column) errors.push("Use a different column after “then”.");
      break;
    case "dependency":
      if (rule.from === rule.to) errors.push("Choose two different columns.");
      break;
    case "arithmetic": {
      const names = ruleColumns(rule);
      if (new Set(names).size !== 3) errors.push("Choose three different columns.");
      if (names.some((name) => column(name)!.type !== "measure")) errors.push("All three columns must be number columns.");
      if (!(rule.tolerance >= 0)) errors.push("The tolerance must be zero or more.");
      break;
    }
  }
  return errors;
}
