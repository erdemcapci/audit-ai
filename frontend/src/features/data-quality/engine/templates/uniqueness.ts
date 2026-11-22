import { isMissing } from "../csv";
import type { TestTemplate } from "../types";
import { card, Collector, column, count, definition, fileRow, percent, quote, severityOf } from "./common";

export const WHOLE_DATASET = "Whole dataset";

type KeyParams = { columns: string[] };

export const uniqueKey: TestTemplate<KeyParams> = {
  id: "uniqueness.key",
  title: "Duplicate keys",
  dimension: "uniqueness",
  summary: "Finds identifiers, such as invoice or document numbers, that appear more than once.",
  appliesTo: "Identifier columns where nearly every value is unique",
  detailView: "records",
  autoInstances: (profile) => profile.columns
    .filter((c) => c.type === "identifier" && c.uniquePercent >= 99 && c.blankPercent < 50)
    .map((c) => definition("uniqueness.key", c.name, { columns: [c.name] }, `${percent(c.uniquePercent)} of values are unique, so ${quote(c.name)} looks like a key that should never repeat.`)),
  describe: (d) => `Each value of ${d.params.columns.map(quote).join(" + ")} should appear only once.`,
  run(data, params, ctx) {
    const infos = params.columns.map((name) => column(ctx.profile, name));
    const keyOf = (r: string[]) => infos.map((c) => (r[c.index] ?? "").trim()).join(" + ");
    const rowsByKey = new Map<string, number[]>();
    let tested = 0;
    data.rows.forEach((r, i) => {
      if (infos.some((c) => isMissing(r[c.index]))) return;
      tested++;
      const key = keyOf(r);
      const rows = rowsByKey.get(key);
      if (rows) rows.push(i); else rowsByKey.set(key, [i]);
    });
    const collector = new Collector();
    let duplicated = 0;
    const flagged: { index: number; key: string; times: number }[] = [];
    rowsByKey.forEach((rows, key) => {
      if (rows.length < 2) return;
      duplicated++;
      rows.forEach((index) => flagged.push({ index, key, times: rows.length }));
    });
    flagged.sort((a, b) => a.index - b.index).forEach((f) => collector.add(fileRow(f.index), f.key, `Appears ${f.times} times`));
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const summary = collector.total
      ? `${count(duplicated)} value${duplicated === 1 ? " appears" : "s appear"} more than once, in ${count(collector.total)} records (${percent(rate)}).`
      : "Every value is unique.";
    return card({ testId: ctx.testId, subject: params.columns.join(" + "), tested, collector, severity: severityOf(collector.total, rate, 3, infos[0]?.type), summary });
  }
};

export const duplicateRows: TestTemplate<Record<string, never>> = {
  id: "uniqueness.row",
  title: "Duplicate rows",
  dimension: "uniqueness",
  summary: "Finds records that are exact copies of an earlier record.",
  appliesTo: "Files with more than one row",
  detailView: "records",
  autoInstances: (profile) => (profile.rows > 1 ? [definition("uniqueness.row", WHOLE_DATASET, {}, "Exact copies usually come from a double export or a double posting.")] : []),
  describe: () => "No record should be an exact copy of another.",
  run(data, _params, ctx) {
    const firstRow = new Map<string, number>();
    const collector = new Collector();
    data.rows.forEach((r, i) => {
      const key = r.join("\u0001");
      const first = firstRow.get(key);
      if (first === undefined) firstRow.set(key, i);
      else collector.add(fileRow(i), r.slice(0, 3).join(" | ") + (r.length > 3 ? " | …" : ""), `Same as row ${fileRow(first)}`);
    });
    const tested = data.rows.length;
    const rate = tested ? (collector.total / tested) * 100 : 0;
    const summary = collector.total ? `${count(collector.total)} record${collector.total === 1 ? " is an exact copy" : "s are exact copies"} of an earlier record (${percent(rate)}).` : "No duplicate records.";
    return card({ testId: ctx.testId, subject: WHOLE_DATASET, tested, collector, severity: severityOf(collector.total, rate, 2), summary });
  }
};
