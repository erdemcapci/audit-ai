import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

/*
 * "Any file" guarantees. The engine must complete on whatever CSV an auditor loads: random column
 * mixes, junk values, odd headers and delimiters, degenerate shapes and wide files. Results must stay
 * internally consistent, and real-world number and date conventions must be read correctly.
 * Seed with DQ_SEED to explore other random files.
 */

let server, csv, numbers, dates, profileMod, runner, session, types, rules;
before(async () => {
  server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, ws: false }, appType: "custom" });
  const load = (path) => server.ssrLoadModule(`/src/features/data-quality/engine/${path}`);
  [csv, numbers, dates, profileMod, runner, session, types, rules] = await Promise.all(["csv.ts", "numbers.ts", "dates.ts", "profile.ts", "runner.ts", "session.ts", "types.ts", "rules.ts"].map(load));
});
after(async () => { await server?.close(); });

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(Number(process.env.DQ_SEED) || 20261122);
const int = (a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (list) => list[int(0, list.length - 1)];
const day = (n) => new Date(Date.UTC(2020, 0, 1) + n * 864e5);
const pad = (v) => String(v).padStart(2, "0");

const JUNK = ["", " ", "NULL", "n/a", "-", "TBD", "#N/A", "∞", "1e999", "NaN", "😀", "quoted, comma", "x".repeat(300), "0", "-0", "１２３", "١٢٣", "Ä Ö Ü ş ğ ı", "=SUM(A1)", "<script>", "1,234.56", "1.234,56", "(500.00)", "500-", "12'345.00", "€ 12,50", "2024-02-30", "31/12/2024", "12/31/2024", "20240131", "15-Jan-2024", "01.02.24", "line\nbreak", "\"quote\""];
const COLUMNS = [
  () => `ID${int(0, 99999)}`, () => String(int(0, 1e6)), () => (R() * 10000 - 100).toFixed(2), () => (R() * 1000).toFixed(2).replace(".", ","),
  () => pick(["A", "B", "C", "D"]), () => pick(["Yes", "No"]), () => pick(["true", "false"]),
  () => day(int(0, 1500)).toISOString().slice(0, 10), () => { const d = day(int(0, 1500)); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; },
  () => `${pick(["Acme", "Delta", "Nord"])} ${pick(["GmbH", "Ltd", "AB"])} ${int(1, 40)}`, () => "same", () => "",
  () => `${int(1000, 9999)}-${int(10, 99)}`, () => String(int(1, 9)), () => `${R() < 0.5 ? "-" : ""}${int(1, 9)}.${int(100, 999)},${int(10, 99)}`
];

function randomFile() {
  const cols = pick([1, 2, 3, 5, 8, 15, 40]);
  const rows = pick([1, 2, 3, 10, 50, 200, 1000, 3000]);
  const makers = Array.from({ length: cols }, () => pick(COLUMNS));
  const noise = R() * 0.2;
  const headers = Array.from({ length: cols }, (_, i) => pick([`c${i}`, "", "dup", "Spaced name", "ünïcödé", "a,b", "\"q\""]));
  const delimiter = pick([",", ";", "\t", "|"]);
  const esc = (v) => (/[",\n;|\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers.map(esc).join(delimiter)];
  for (let r = 0; r < rows; r++) lines.push(makers.map((make) => esc(R() < noise ? pick(JUNK) : make())).join(delimiter));
  if (R() < 0.2) lines.push("");
  return lines.join(pick(["\n", "\r\n"]));
}

async function runAll(data, settings = types.DEFAULT_SETTINGS) {
  const profile = profileMod.buildProfile(data, settings);
  const plan = runner.buildStandardPlan(profile, settings).map((t) => ({ ...t, enabled: true }));
  const results = await runner.runPlan(data, profile, plan, settings);
  return { profile, plan, results };
}

function assertConsistent({ data, plan, results }) {
  assert.equal(results.tests.length, 11, "every template is reported once");
  const cards = results.tests.flatMap((t) => t.cards);
  const failed = results.tests.flatMap((t) => t.notes.filter((n) => n.reason.startsWith("Could not run")));
  assert.deepEqual(failed, [], "no test failed");
  assert.equal(cards.length, plan.length, "one result card per enabled test");
  for (const c of cards) {
    assert.ok(Number.isFinite(c.rate) && c.rate >= 0 && c.rate <= 100.0001, `${c.testId}: rate ${c.rate}`);
    assert.ok(c.exceptions <= c.tested, `${c.testId}: ${c.exceptions} exceptions of ${c.tested}`);
    assert.ok(c.tested <= data.rows.length, `${c.testId}: tested ${c.tested} of ${data.rows.length} rows`);
    assert.ok((c.records ?? []).length <= 20000, `${c.testId}: exception list is capped`);
    if (c.detail?.bins) assert.ok(c.detail.bins.every((b) => Number.isFinite(b.from) && Number.isFinite(b.to)), `${c.testId}: finite histogram`);
  }
  const totals = runner.totalsOf(results.tests);
  assert.deepEqual(results.totals, totals);
}

test("the engine completes with consistent results on 150 random, messy files", async () => {
  let tested = 0;
  for (let k = 0; k < 150; k++) {
    const text = randomFile();
    const data = csv.parseCsv(text, "random.csv");
    if (!data.headers.length || !data.rows.length) continue;
    const { profile, plan, results } = await runAll(data);
    assertConsistent({ data, plan, results });
    const content = session.buildRecordContent({ source: { name: "random.csv", size: text.length, rows: data.rows.length, columns: data.headers.length, headers: data.headers, content_hash: "", stored: true }, executed: { profile, results, steps: [], changes: [] }, plan, settings: types.DEFAULT_SETTINGS, createdAt: "2026-11-22T10:00:00Z" });
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(content)));
    tested++;
  }
  assert.ok(tested > 100);
});

test("degenerate files: one cell, one row, empty columns, duplicate and blank headers", async () => {
  for (const text of ["a\n1", "a,b\n,", "a,a,\nx,y,z", "only\n\n\n", "x;y\n1;2\n1;2", ",,,\n,,,\n1,,,"]) {
    const data = csv.parseCsv(text, "tiny.csv");
    if (!data.rows.length) continue;
    const { plan, results } = await runAll(data);
    assertConsistent({ data, plan, results });
  }
  assert.throws(() => session.readSource(new TextEncoder().encode("header_only\n").buffer, "h.csv"), /no data rows/);
});

test("a wide file with 200 columns completes and keeps memory bounded", async () => {
  const cols = 200, rows = 400;
  const lines = [Array.from({ length: cols }, (_, c) => `col_${c}`).join(",")];
  for (let r = 0; r < rows; r++) lines.push(Array.from({ length: cols }, (_, c) => (c % 4 === 0 ? "" : c % 4 === 1 ? `K${r % 37}` : c % 4 === 2 ? (r * 1.5 + c).toFixed(2) : day(r + c).toISOString().slice(0, 10))).join(","));
  const data = csv.parseCsv(lines.join("\n"), "wide.csv");
  const started = performance.now();
  const { profile, plan, results } = await runAll(data);
  assert.ok(performance.now() - started < 30000);
  assertConsistent({ data, plan, results });
  const emptyBlank = results.tests.find((t) => t.template === "completeness.blank").cards.find((c) => c.subject === "col_0");
  assert.equal(emptyBlank.exceptions, rows);
  assert.equal(emptyBlank.records.length, 0, "an empty column is one finding, not a list of every row");
  assert.match(profile.discoveryNote ?? "", /Wide file/);
});

test("European and accounting number formats are read as the same amounts", () => {
  assert.equal(numbers.parseAmount("1.234,56", ","), 1234.56);
  assert.equal(numbers.parseAmount("1,234.56", "."), 1234.56);
  assert.equal(numbers.parseAmount("12,5", ","), 12.5);
  assert.equal(numbers.parseAmount("500.00-", "."), -500);
  assert.equal(numbers.parseAmount("(1,250.00)", "."), -1250);
  assert.equal(numbers.parseAmount("€ 12,50", ","), 12.5);
  assert.equal(numbers.parseAmount("12'345.00", "."), 12345);
  assert.equal(numbers.parseAmount("1 234,56", ","), 1234.56);
  assert.equal(numbers.parseAmount("1e999", "."), null, "infinity is not an amount");
  assert.equal(numbers.parseAmount("1,2,3", ","), null);
  assert.equal(numbers.detectDecimalMark(["1.234,56", "12,50", "7"]), ",");
  assert.equal(numbers.detectDecimalMark(["1,234.56", "12.50", "7"]), ".");
  assert.equal(numbers.detectDecimalMark(["1,234", "5"]), ".", "ambiguous values do not vote");
});

test("a decimal-comma file is tested on the right amounts", async () => {
  const lines = ["net;tax;gross"];
  for (let i = 0; i < 300; i++) {
    const net = 1000 + i * 7.25;
    const tax = Math.round(net * 19) / 100;
    const fmt = (n) => n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    lines.push([fmt(net), fmt(tax), fmt(i === 5 ? net + tax + 10 : net + tax)].join(";"));
  }
  lines.push("5.000.000,00;950.000,00;5.950.000,00"); // one far larger invoice
  const data = csv.parseCsv(lines.join("\n"), "de.csv");
  const { profile, results } = await runAll(data);
  const net = profile.columns.find((c) => c.name === "net");
  assert.equal(net.type, "measure");
  assert.equal(net.measure.decimal, ",");
  assert.ok(net.measure.max > 4_000_000, `max read as ${net.measure.max}`);
  const sum = results.tests.find((t) => t.template === "rule").cards.find((c) => c.subject === "net + tax = gross");
  assert.ok(sum, "the sum is discovered with decimal commas");
  assert.equal(sum.exceptions, 1);
  const outlier = results.tests.find((t) => t.template === "accuracy.outlier").cards.find((c) => c.subject === "net");
  assert.equal(outlier.exceptions, 1, "the 5 million invoice is the outlier, not misread values");
  assert.equal(results.tests.find((t) => t.template === "validity.type").cards.find((c) => c.subject === "net").exceptions, 0);
});

test("common export date formats are recognised, identifiers are not", () => {
  const formatOf = (values) => dates.detectDateFormat(values)?.format ?? null;
  assert.equal(formatOf(["20240131", "20231215", "20220101"]), "yyyyMMdd");
  assert.equal(formatOf(["15-Jan-2024", "3-Feb-2024", "28-DEC-2023"]), "d-MMM-yyyy");
  assert.equal(formatOf(["31.01.24", "15.12.23"]), "dd.MM.yy");
  assert.equal(formatOf(["2024-01-31 14:05:00", "2024-02-01T08:00:00Z"]), "yyyy-MM-dd");
  assert.equal(formatOf(["12345678", "87654321", "10000001"]), null, "8-digit identifiers are not dates");
  assert.equal(dates.formatDay(dates.parseDate("31.01.24", "dd.MM.yy")), "2024-01-31");
  assert.equal(dates.formatDay(dates.parseDate("01.01.87", "dd.MM.yy")), "1987-01-01");
  assert.equal(dates.parseDate("20241301", "yyyyMMdd"), null);
});

test("a test that cannot run is reported and the run continues", async () => {
  const data = csv.parseCsv("a,b\n1,2\n3,4", "x.csv");
  const profile = profileMod.buildProfile(data, types.DEFAULT_SETTINGS);
  const broken = { id: "completeness.blank:gone", template: "completeness.blank", subject: "gone", params: { column: "gone" }, source: "auditor", reason: "", enabled: true };
  const plan = [...runner.buildStandardPlan(profile, types.DEFAULT_SETTINGS), broken];
  const results = await runner.runPlan(data, profile, plan, types.DEFAULT_SETTINGS);
  const blank = results.tests.find((t) => t.template === "completeness.blank");
  assert.equal(blank.cards.length, 2, "the other blank tests still ran");
  assert.match(blank.notes.find((n) => n.subject === "gone").reason, /^Could not run: Column not found: gone/);
});

test("saved rules that do not fit a file are rejected before they run", async () => {
  const data = csv.parseCsv("id,amount\nA,1.5\nB,2.5", "other.csv");
  const profile = profileMod.buildProfile(data, types.DEFAULT_SETTINGS);
  assert.notDeepEqual(rules.validateRule({ kind: "compare", left: "doc_date", op: "lte", right: "post_date" }, profile), []);
  assert.notDeepEqual(rules.validateRule({ kind: "compare", left: "id", op: "lte", right: "amount" }, profile), []);
});
