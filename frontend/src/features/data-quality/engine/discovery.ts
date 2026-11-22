import { isMissing, type Dataset } from "./csv";
import { orderedReader } from "./rules";
import type { ColumnInfo, Relationship, RuleParams } from "./types";

/*
 * Relationship discovery on the profile sample. A relationship is proposed when it holds for at least
 * `minHold` of the rows it applies to and is not trivial. A rule that holds for 99% of rows is valuable
 * precisely because of the remaining 1%: those rows are the exceptions the auditor needs to see.
 *
 * Work grows with the square of the number of columns, so very wide files are searched among a capped
 * number of candidate columns (the most promising first) and the result says so.
 */

const MIN_EVIDENCE = 50; // rows a relationship must be checked on
const MIN_VALUE_ROWS = 30; // rows a category value needs before a conditional rule is proposed for it
const MAX_PER_KIND = 8;
const TOLERANCE = 0.01;
const LIMITS = { keys: 25, values: 40, dates: 12, categories: 15, partly: 30, measures: 15 };

type Found = Relationship & { evidence: number };

/** Column values of the sample, read once: trimmed text (null when blank). */
type Column = { info: ColumnInfo; text: (string | null)[]; present: number; avgLength: number };

export function discoverRelationships(data: Dataset, sample: number[], columns: ColumnInfo[], minHold: number): { relationships: Relationship[]; note?: string } {
  const rows = sample.map((i) => data.rows[i]);
  const prepared: Column[] = columns.map((info) => {
    const text = rows.map((r) => (isMissing(r[info.index]) ? null : (r[info.index] ?? "").trim()));
    const values = text.filter((v): v is string => v !== null);
    return { info, text, present: values.length, avgLength: values.reduce((n, v) => n + v.length, 0) / Math.max(values.length, 1) };
  });
  const limited: string[] = [];
  const cap = <T,>(list: T[], limit: number, what: string) => {
    if (list.length > limit) limited.push(`${limit} of ${list.length} ${what}`);
    return list.slice(0, limit);
  };
  const strongest = (found: Found[]) => found.sort((a, b) => b.holdRate - a.holdRate || b.evidence - a.evidence).slice(0, MAX_PER_KIND);
  const relationships = [
    ...strongest(dependencies(prepared, minHold, cap)),
    ...strongest(orderings(rows, prepared, minHold, cap)),
    ...strongest(conditionals(prepared, minHold, cap)),
    ...strongest(arithmetic(rows, prepared, minHold, cap))
  ].map(({ evidence: _evidence, ...relationship }) => relationship);
  return { relationships, note: limited.length ? `Wide file: relationships were searched among ${limited.join(", ")}.` : undefined };
}

type Cap = <T>(list: T[], limit: number, what: string) => T[];

/** Same A, same B: e.g. a vendor number always comes with the same vendor name. */
function dependencies(columns: Column[], minHold: number, cap: Cap): Found[] {
  // Keys repeat the most per value first: those give the most evidence.
  const keys = cap(columns
    .filter((c) => (c.info.type === "identifier" || c.info.type === "category") && c.info.distinct >= 2 && c.present / c.info.distinct >= 1.5)
    .sort((a, b) => b.present / b.info.distinct - a.present / a.info.distinct), LIMITS.keys, "key columns");
  const values = cap(columns.filter((c) => ["identifier", "category", "free_text", "boolean"].includes(c.info.type) && (c.info.topValues[0]?.count ?? 0) / Math.max(c.present, 1) < 0.9), LIMITS.values, "value columns");
  const found: Found[] = [];
  for (const a of keys) {
    for (const b of values) {
      if (a.info.index === b.info.index) continue;
      const groups = new Map<string, Map<string, number>>();
      a.text.forEach((av, k) => {
        const bv = b.text[k];
        if (av === null || bv === null) return;
        let counts = groups.get(av);
        if (!counts) { counts = new Map(); groups.set(av, counts); }
        counts.set(bv, (counts.get(bv) ?? 0) + 1);
      });
      let evidence = 0, held = 0, repeated = 0;
      groups.forEach((counts) => {
        let size = 0, top = 0;
        counts.forEach((n) => { size += n; if (n > top) top = n; });
        if (size < 2) return;
        repeated++;
        evidence += size;
        held += top;
      });
      if (evidence < MIN_EVIDENCE || repeated < 10) continue;
      const holdRate = held / evidence;
      if (holdRate >= minHold) found.push({ rule: { kind: "dependency", from: a.info.name, to: b.info.name }, holdRate, checked: evidence, evidence });
    }
  }
  // A one-to-one pair (number <-> name) is one relationship: keep the direction from the code-like
  // column — an identifier, or else the one with shorter values — to the descriptive one.
  const rank = (name: string) => {
    const c = columns.find((col) => col.info.name === name)!;
    return (c.info.type === "identifier" ? 1000 : 0) - c.avgLength;
  };
  return found.filter((f) => {
    const { from, to } = f.rule as Extract<RuleParams, { kind: "dependency" }>;
    const reverse = found.some((g) => g.rule.kind === "dependency" && g.rule.from === to && g.rule.to === from);
    return !reverse || rank(from) > rank(to) || (rank(from) === rank(to) && from < to);
  });
}

/** One date never after another: document date on or before posting date. */
function orderings(rows: string[][], columns: Column[], minHold: number, cap: Cap): Found[] {
  const dates = cap(columns.filter((c) => c.info.type === "date" && c.info.date), LIMITS.dates, "date columns");
  const parsed = new Map(dates.map((c) => [c.info.name, rows.map((r) => orderedReader(c.info)(r[c.info.index] ?? ""))]));
  const found: Found[] = [];
  dates.forEach((a, i) => dates.slice(i + 1).forEach((b) => {
    const av = parsed.get(a.info.name)!, bv = parsed.get(b.info.name)!;
    let n = 0, before = 0, after = 0, same = 0;
    av.forEach((x, k) => {
      const y = bv[k];
      if (x === null || y === null) return;
      n++;
      if (x <= y) before++;
      if (x >= y) after++;
      if (x === y) same++;
    });
    if (n < MIN_EVIDENCE || same / n > 0.9) return; // (nearly) the same date twice says nothing
    if (before / n >= minHold) found.push({ rule: { kind: "compare", left: a.info.name, op: "lte", right: b.info.name }, holdRate: before / n, checked: n, evidence: n });
    else if (after / n >= minHold) found.push({ rule: { kind: "compare", left: b.info.name, op: "lte", right: a.info.name }, holdRate: after / n, checked: n, evidence: n });
  }));
  return found;
}

/** A status that goes with a filled-in (or blank) column: status Closed <-> close date filled in. */
function conditionals(columns: Column[], minHold: number, cap: Cap): Found[] {
  const total = columns[0]?.text.length ?? 0;
  if (!total) return [];
  const categories = cap(columns.filter((c) => (c.info.type === "category" || c.info.type === "boolean") && c.info.distinct <= 20), LIMITS.categories, "category columns");
  const partly = cap(columns.filter((c) => {
    const blank = 1 - c.present / total;
    return blank >= 0.02 && blank <= 0.98;
  }), LIMITS.partly, "partly filled columns");
  const found: Found[] = [];
  for (const cat of categories) {
    for (const target of partly) {
      if (cat.info.index === target.info.index) continue;
      const filledOverall = target.present / total;
      const byValue = new Map<string, { rows: number; filled: number }>();
      const whenFilled = new Map<string, number>();
      let filledWithCategory = 0;
      cat.text.forEach((v, k) => {
        if (v === null) return;
        const filled = target.text[k] !== null;
        const entry = byValue.get(v) ?? { rows: 0, filled: 0 };
        entry.rows++;
        if (filled) {
          entry.filled++;
          filledWithCategory++;
          whenFilled.set(v, (whenFilled.get(v) ?? 0) + 1);
        }
        byValue.set(v, entry);
      });
      const categoryRows = [...byValue.values()].reduce((n, e) => n + e.rows, 0);
      byValue.forEach((entry, value) => {
        if (entry.rows < MIN_VALUE_ROWS) return;
        const filled = entry.filled / entry.rows;
        const when = { column: cat.info.name, op: "eq" as const, value };
        if (filled >= minHold && filledOverall < 0.9) found.push({ rule: { kind: "conditional", if: when, then: { column: target.info.name, op: "not_empty" } }, holdRate: filled, checked: entry.rows, evidence: entry.rows });
        else if (1 - filled >= minHold && filledOverall > 0.1) found.push({ rule: { kind: "conditional", if: when, then: { column: target.info.name, op: "empty" } }, holdRate: 1 - filled, checked: entry.rows, evidence: entry.rows });
      });
      // The other direction: whenever the column is filled in, the category has one particular value.
      if (filledWithCategory < MIN_EVIDENCE) continue;
      const [value, count] = [...whenFilled.entries()].sort((a, b) => b[1] - a[1])[0];
      const overall = (byValue.get(value)?.rows ?? 0) / Math.max(categoryRows, 1);
      if (count / filledWithCategory >= minHold && overall < 0.9) {
        found.push({ rule: { kind: "conditional", if: { column: target.info.name, op: "not_empty" }, then: { column: cat.info.name, op: "in", values: [value] } }, holdRate: count / filledWithCategory, checked: filledWithCategory, evidence: filledWithCategory });
      }
    }
  }
  return found;
}

/** Amounts that add up or multiply: net + tax = gross, quantity × price = amount. */
function arithmetic(rows: string[][], columns: Column[], minHold: number, cap: Cap): Found[] {
  const measures = cap(columns.filter((c) => c.info.type === "measure"), LIMITS.measures, "number columns");
  const parsed = new Map(measures.map((c) => [c.info.name, rows.map((r) => orderedReader(c.info)(r[c.info.index] ?? ""))]));
  // Share of values that are 0 (neutral for a sum) or 1 (neutral for a product), per column.
  const neutralShare = new Map(measures.map((c) => {
    const known = parsed.get(c.info.name)!.filter((v): v is number => v !== null);
    const share = (target: number) => (known.length ? known.filter((v) => v === target).length / known.length : 1);
    return [c.info.name, { sum: share(0), product: share(1) }];
  }));
  const found: Found[] = [];
  measures.forEach((a, i) => measures.slice(i + 1).forEach((b) => {
    const av = parsed.get(a.info.name)!, bv = parsed.get(b.info.name)!;
    measures.forEach((c) => {
      if (c.info.index === a.info.index || c.info.index === b.info.index) return;
      const cv = parsed.get(c.info.name)!;
      (["sum", "product"] as const).forEach((formula) => {
        if (neutralShare.get(a.info.name)![formula] > 0.9 || neutralShare.get(b.info.name)![formula] > 0.9) return; // c would simply equal a or b
        let n = 0, held = 0;
        av.forEach((x, k) => {
          const y = bv[k], z = cv[k];
          if (x === null || y === null || z === null) return;
          n++;
          if (Math.abs((formula === "sum" ? x + y : x * y) - z) <= TOLERANCE + 1e-9) held++;
        });
        if (n >= MIN_EVIDENCE && held / n >= minHold) {
          found.push({ rule: { kind: "arithmetic", formula, inputs: [a.info.name, b.info.name], result: c.info.name, tolerance: TOLERANCE }, holdRate: held / n, checked: n, evidence: n });
        }
      });
    });
  }));
  return found;
}
