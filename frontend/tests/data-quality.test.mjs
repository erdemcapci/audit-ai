import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server, csv, dq;
before(async () => {
  server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, ws: false }, appType: "custom" });
  csv = await server.ssrLoadModule("/src/features/data-quality/engine/csv.ts");
  dq = await server.ssrLoadModule("/src/features/data-quality/engine/patterns.ts");
});
after(async () => { await server?.close(); });

const digits = (n, seed) => String(seed).padStart(n, "0").slice(-n);

/** 1,000 rows: AA tax = AA+8 digits (60%), BB tax = 10 digits (40%), plus a 40-row CC group. */
function fixture() {
  const lines = ["customer_id,country,tax_number,amount,vendor,notes"];
  const vendors = ["Acme", "Borealis Logistics", "Co", "Delta Office Supplies"];
  for (let i = 0; i < 1000; i++) {
    const aa = i % 5 < 3;
    lines.push([`C${digits(6, 100000 + i)}`, aa ? "AA" : "BB", aa ? `AA${digits(8, 31415926 + i * 7)}` : digits(10, 2718281828 + i * 13), `${(i * 37) % 9000}.${digits(2, i)}`, vendors[i % 4], `free text number ${"x".repeat(i % 17)} ${i % 3 ? "a-b" : "c d e"}`].join(","));
  }
  for (let i = 0; i < 40; i++) lines.push([`C${digits(6, 900000 + i)}`, "CC", `CC${digits(6, 123456 + i)}`, `${i * 11}.50`, vendors[i % 4], "short note"].join(","));
  return lines;
}

test("parseCsv handles quotes, embedded commas/newlines and semicolon delimiters", () => {
  const data = csv.parseCsv('id,note\r\n1,"a, ""b"""\r\n2,"line1\nline2"\r\n');
  assert.deepEqual(data.headers, ["id", "note"]);
  assert.deepEqual(data.rows, [["1", 'a, "b"'], ["2", "line1\nline2"]]);
  assert.deepEqual(csv.parseCsv("a;b\n1;2").rows, [["1", "2"]]);
});

test("toPatternKey translates letters, digits and special characters", () => {
  assert.equal(dq.toPatternKey("AB-12"), "L-L-S-N-N");
  assert.equal(dq.toPatternKey("AB-12", true), "L-L---N-N");
  assert.equal(dq.toPatternKey("Çä9"), "L-L-N");
});

test("profiling classifies columns from their data and picks a helpful grouping", () => {
  const lines = fixture();
  lines[2] = lines[2].replace(/AA(\d{8})/, "AA-$1"); // one rare AA pattern
  lines[4] = lines[4].replace(/,BB,(\d{10})/, ",BB,$1X"); // one rare BB pattern
  const data = csv.parseCsv(lines.join("\n"));
  const by = Object.fromEntries(dq.profileDataset(data, false).map((p) => [p.column, p]));
  assert.equal(by.customer_id.verdict, "suitable"); // unique values, one pattern
  assert.equal(by.customer_id.grouping, null);
  assert.equal(by.tax_number.verdict, "suitable");
  assert.equal(by.tax_number.grouping.column, "country"); // formats differ by country
  assert.equal(by.amount.verdict, "unsuitable"); // numeric measure
  assert.equal(by.vendor.verdict, "unsuitable"); // category label
  assert.equal(by.notes.verdict, "unsuitable"); // free text
  assert.ok(by.notes.reasons[0].length > 10, "excluded columns carry a reason");
});

test("analysis flags rare patterns within the chosen group and never ungrouped formats", () => {
  const lines = fixture();
  lines[2] = lines[2].replace(/AA(\d{8})/, "AA-$1");
  lines[4] = lines[4].replace(/,BB,(\d{10})/, ",BB,$1X");
  lines[5] = lines[5].replace(/,BB,\d{10}/, ",BB,");
  const data = csv.parseCsv(lines.join("\n"));
  const profiles = dq.profileDataset(data, false);
  const { findings, excluded, anomalousRecords } = dq.analyzeDataset(data, profiles, dq.DEFAULT_OPTIONS);
  const tax = findings.find((f) => f.column === "tax_number");
  assert.equal(tax.group, "country");
  assert.equal(tax.blank, 1);
  const rare = tax.anomalyRecords.filter((r) => r.kind === "rare");
  assert.deepEqual(rare.map((r) => r.row).sort((a, b) => a - b), [3, 5]);
  assert.equal(rare.find((r) => r.row === 3).usualPattern, "L-L-N-N-N-N-N-N-N-N");
  assert.equal(tax.anomalies, 2);
  assert.equal(findings[0].column, "tax_number"); // highest priority first
  assert.equal(anomalousRecords, 2);
  assert.ok(excluded.some((p) => p.column === "amount"));
  assert.equal(tax.groups.find((g) => g.group === "CC").status, "assessed");

  // Per-group drill-down: rare vs common patterns, each with example records from the data.
  const aa = tax.groups.find((g) => g.group === "AA");
  const aaRare = aa.patterns.filter((p) => p.kind === "rare");
  assert.deepEqual(aaRare.map((p) => p.samples.map((x) => x.value)), [["AA-" + lines[2].split(",")[2].slice(2).replace(/^-/, "")]]);
  assert.equal(aaRare[0].samples[0].row, 3);
  const aaCommon = aa.patterns.filter((p) => p.kind === "common");
  assert.equal(aaCommon.length, 1);
  assert.equal(aaCommon[0].samples.length, 10); // capped preview
  assert.ok(aaCommon[0].count > 100);
  const bb = tax.groups.find((g) => g.group === "BB");
  assert.deepEqual(bb.patterns.filter((p) => p.kind === "blank").map((p) => [p.count, p.samples[0].row]), [[1, 6]]);
});

test("small groups flag single-record patterns only when one pattern dominates; tiny groups are skipped", () => {
  const lines = ["id,country,tax"];
  for (let i = 0; i < 300; i++) lines.push(`${i},AA,AA${digits(8, 10000000 + i)}`);
  for (let i = 0; i < 300; i++) lines.push(`${i},BB,${digits(10, 2000000000 + i)}`);
  for (let i = 0; i < 29; i++) lines.push(`${i},CC,CC${digits(5, 12345 + i)}`);
  lines.push("1,CC,CC-12345"); // 1 in 30 (3.3%): the 3% threshold alone cannot flag it
  for (let i = 0; i < 4; i++) lines.push(`${i},DD,DD${digits(4, i)}`); // too few to judge
  const data = csv.parseCsv(lines.join("\n"));
  const profile = dq.profileDataset(data, false).find((p) => p.column === "tax");
  const f = dq.analyzeColumn(data, profile, "country", "", dq.DEFAULT_OPTIONS);
  const cc = f.groups.find((g) => g.group === "CC");
  assert.equal(cc.anomalies, 1);
  assert.match(cc.note, /Small group/);
  assert.equal(f.groups.find((g) => g.group === "DD").status, "too-small");
});

test("overrides force a column in or out and change the grouping", () => {
  const data = csv.parseCsv(fixture().join("\n"));
  const profiles = dq.profileDataset(data, false);
  const forced = dq.analyzeDataset(data, profiles, { ...dq.DEFAULT_OPTIONS, include: { amount: true, customer_id: false }, group: { tax_number: "none" } });
  assert.ok(forced.findings.some((f) => f.column === "amount"));
  assert.ok(!forced.findings.some((f) => f.column === "customer_id"));
  assert.equal(forced.findings.find((f) => f.column === "tax_number").group, null);
});

test("decimal columns with any number of decimals are treated as measures", () => {
  const lines = ["id,weight"];
  for (let i = 0; i < 300; i++) lines.push(`ID${digits(5, i)},${(i * 1.37 + 0.5).toFixed(3)}`);
  const by = Object.fromEntries(dq.profileDataset(csv.parseCsv(lines.join("\n")), false).map((p) => [p.column, p]));
  assert.equal(by.weight.verdict, "unsuitable");
  assert.equal(by.weight.isMeasure, true);
});
