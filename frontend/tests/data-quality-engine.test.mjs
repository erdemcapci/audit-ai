import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer } from "vite";

/*
 * Template engine checks. A synthetic file with known, non-overlapping issues: every standard test
 * must find exactly what was seeded, and nothing else.
 */

let server, csv, dates, profileMod, runner, session, types;
before(async () => {
  server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, ws: false }, appType: "custom" });
  const load = (path) => server.ssrLoadModule(`/src/features/data-quality/engine/${path}`);
  [csv, dates, profileMod, runner, session, types] = await Promise.all(["csv.ts", "dates.ts", "profile.ts", "runner.ts", "session.ts", "types.ts"].map(load));
});
after(async () => { await server?.close(); });

const pad = (v, n) => String(v).padStart(n, "0");
const iso = (day) => new Date(day * 86400000).toISOString().slice(0, 10);

/** 400 rows plus two exact copies. Seeded issues are listed next to each override. */
function fixture() {
  const start = Date.UTC(2023, 0, 2) / 86400000; // Monday
  const rows = [];
  for (let i = 0; i < 400; i++) {
    rows.push({
      doc_id: `D${pad(i + 1, 6)}`,
      status: i % 2 ? "Open" : "Closed",
      amount: `${100 + ((i * 37) % 900)}.25`,
      posted: iso(start + Math.floor(i / 5) * 7 + (i % 5)), // weekdays only
      approved: i % 2 ? "Y" : "N",
      notes: i % 3 === 0 ? "" : `Delivered to warehouse number ${i % 7} without remarks`,
      country: "NL",
      empty: ""
    });
  }
  rows[10].doc_id = rows[9].doc_id; // duplicate key
  [20, 21, 22].forEach((i) => { rows[i].status = "Closed "; }); // spelling variants
  [23, 24].forEach((i) => { rows[i].status = "CLOSED"; });
  [30, 31].forEach((i) => { rows[i].amount = "abc"; }); // not numbers
  [40, 41, 42].forEach((i) => { rows[i].amount = "-15.00"; }); // rare negatives
  rows[50].amount = "999999"; // filler number (also an outlier)
  rows[60].amount = "5000000.00"; // outlier
  rows[70].posted = "2023-02-31"; // invalid date
  rows[71].posted = "2099-12-31"; // placeholder date
  rows[72].posted = "2031-05-05"; // future (a Monday)
  [80, 81, 82, 83, 84].forEach((i) => { rows[i].posted = "2023-01-07"; }); // Saturday
  rows[90].approved = "maybe"; // not yes/no
  rows.push({ ...rows[100] }, { ...rows[101] }); // exact copies (also duplicate keys)
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => r[h]).join(","))].join("\n");
}

async function runFixture(adjust = (plan) => plan) {
  const data = csv.parseCsv(fixture(), "fixture.csv");
  const profile = profileMod.buildProfile(data, types.DEFAULT_SETTINGS);
  const plan = adjust(runner.buildStandardPlan(profile, types.DEFAULT_SETTINGS));
  const results = await runner.runPlan(data, profile, plan, types.DEFAULT_SETTINGS);
  const exceptions = (template, subject) => results.tests.find((t) => t.template === template)?.cards.find((c) => c.subject === subject)?.exceptions;
  return { data, profile, plan, results, exceptions };
}

test("date detection reads real dates only and flags ambiguous day/month order", () => {
  assert.equal(dates.parseDate("2023-02-31", "yyyy-MM-dd"), null);
  assert.equal(dates.parseDate("29.02.2024", "dd.MM.yyyy"), dates.parseDate("2024-02-29", "yyyy-MM-dd"));
  assert.equal(dates.parseDate("2023-10-05T14:30:00Z", "yyyy-MM-dd"), dates.parseDate("2023-10-05", "yyyy-MM-dd"));
  assert.equal(dates.formatDay(dates.parseDate("0001-01-01", "yyyy-MM-dd")), "0001-01-01");
  assert.equal(dates.weekday(dates.parseDate("2023-01-07", "yyyy-MM-dd")), 6);
  assert.deepEqual(dates.detectDateFormat(["13.01.2024", "02.02.2024"]), { format: "dd.MM.yyyy", alternatives: [], parsedShare: 1 });
  const ambiguous = dates.detectDateFormat(["01/02/2024", "03/04/2024"]);
  assert.equal(ambiguous.format, "dd/MM/yyyy");
  assert.deepEqual(ambiguous.alternatives, ["MM/dd/yyyy"]);
  assert.equal(dates.detectDateFormat(["12/31/2024", "01/15/2024"]).format, "MM/dd/yyyy");
  assert.equal(dates.detectDateFormat(["hello", "2024-01-01"]), null);
});

test("profiling reads the type of every column, with its reason", async () => {
  const { profile } = await runFixture();
  const typeOf = Object.fromEntries(profile.columns.map((c) => [c.name, c.type]));
  assert.deepEqual(typeOf, { doc_id: "identifier", status: "category", amount: "measure", posted: "date", approved: "boolean", notes: "free_text", country: "constant", empty: "empty" });
  assert.ok(profile.columns.every((c) => c.typeReason.length > 0));
  assert.equal(profile.columns.find((c) => c.name === "posted").date.format, "yyyy-MM-dd");
});

test("the standard plan follows the column types", async () => {
  const { plan } = await runFixture();
  const templatesFor = (subject) => plan.filter((t) => t.subject === subject).map((t) => t.template).sort();
  assert.deepEqual(templatesFor("posted"), ["accuracy.calendar", "completeness.blank", "completeness.placeholder", "validity.range", "validity.type"]);
  assert.deepEqual(templatesFor("approved"), ["completeness.blank", "validity.type"]);
  assert.deepEqual(templatesFor("amount"), ["accuracy.outlier", "completeness.blank", "completeness.placeholder", "validity.range", "validity.type"]);
  assert.ok(templatesFor("doc_id").includes("uniqueness.key"));
  assert.ok(templatesFor("doc_id").includes("validity.pattern"));
  assert.deepEqual(templatesFor("status").filter((t) => t.startsWith("validity")), ["validity.allowed_values"]);
  assert.equal(new Set(plan.map((t) => t.id)).size, plan.length, "test ids are unique");
  assert.ok(plan.every((t) => t.source === "standard" && t.reason));
});

test("every standard test finds exactly the seeded issues", async () => {
  const { exceptions, results } = await runFixture();
  assert.equal(exceptions("completeness.blank", "notes"), 134);
  assert.equal(exceptions("completeness.blank", "empty"), 402);
  assert.equal(exceptions("completeness.blank", "amount"), 0);
  assert.equal(exceptions("completeness.placeholder", "amount"), 1);
  assert.equal(exceptions("completeness.placeholder", "posted"), 1);
  assert.equal(exceptions("validity.type", "amount"), 2);
  assert.equal(exceptions("validity.type", "posted"), 1);
  assert.equal(exceptions("validity.type", "approved"), 1);
  assert.equal(exceptions("validity.allowed_values", "status"), 5);
  assert.equal(exceptions("validity.range", "posted"), 1);
  assert.equal(exceptions("validity.range", "amount"), 3);
  assert.equal(exceptions("uniqueness.key", "doc_id"), 6);
  assert.equal(exceptions("uniqueness.row", "Whole dataset"), 2);
  assert.equal(exceptions("accuracy.outlier", "amount"), 2);
  assert.equal(exceptions("accuracy.calendar", "posted"), 5);
  assert.equal(exceptions("validity.pattern", "doc_id"), 0);

  const variants = results.tests.find((t) => t.template === "validity.allowed_values").cards[0];
  assert.match(variants.summary, /1 value is spelled in more than one way, affecting 5 records/);
  assert.deepEqual(variants.examples.map((e) => e.row), [22, 23, 24, 25, 26], "row numbers match the file (header is row 1)");
});

test("severity weighs the share of records, the test and the column type", async () => {
  const { results } = await runFixture();
  const card = (template, subject) => results.tests.find((t) => t.template === template).cards.find((c) => c.subject === subject);
  assert.equal(card("completeness.blank", "empty").severity, "medium"); // 100% blank, but an empty column weighs little
  assert.equal(card("completeness.blank", "notes").severity, "medium"); // 33% blank free text
  assert.equal(card("uniqueness.key", "doc_id").severity, "high"); // 1.5% duplicate keys in an identifier
  assert.equal(card("accuracy.calendar", "posted").severity, "low"); // 1.3% weekend dates
  assert.equal(card("completeness.blank", "amount").severity, "clean");
  assert.ok(results.tests.find((t) => t.template === "completeness.blank").cards[0].severity !== "clean", "cards are sorted by severity");
});

test("switched-off and not applicable tests are reported, not run", async () => {
  const { results } = await runFixture((plan) => plan.map((t) => (t.template === "accuracy.outlier" ? { ...t, enabled: false } : t)));
  assert.equal(results.tests.find((t) => t.template === "accuracy.outlier").status, "switched_off");
  const data = csv.parseCsv("code,label\nA1,x\nA2,y\nA3,z", "tiny.csv");
  const profile = profileMod.buildProfile(data, types.DEFAULT_SETTINGS);
  const tiny = await runner.runPlan(data, profile, runner.buildStandardPlan(profile, types.DEFAULT_SETTINGS), types.DEFAULT_SETTINGS);
  assert.equal(tiny.tests.find((t) => t.template === "accuracy.calendar").status, "not_applicable");
  assert.equal(tiny.tests.length, 10, "every template appears once");
});

test("totals and the code verdict summarise the cards", async () => {
  const { results } = await runFixture();
  const cards = results.tests.flatMap((t) => t.cards);
  assert.equal(results.totals.tests, cards.length);
  assert.equal(results.totals.findings, cards.filter((c) => c.exceptions).length);
  assert.equal(results.totals.exceptions, cards.reduce((n, c) => n + c.exceptions, 0));
  assert.equal(results.verdict, results.totals.high ? "significant_issues" : "issues_to_review");
});

test("the auditor's changes to the standard plan are recorded", async () => {
  const { profile } = await runFixture();
  const standard = runner.buildStandardPlan(profile, types.DEFAULT_SETTINGS);
  const final = standard.map((t) => (t.id === "accuracy.calendar:posted" ? { ...t, enabled: false } : t.id === "validity.pattern:doc_id" ? { ...t, params: { ...t.params, group: "none" } } : t));
  const changes = runner.planChanges(standard, final);
  assert.deepEqual(changes.map((c) => [c.testId, c.change]), [["validity.pattern:doc_id", "changed"], ["accuracy.calendar:posted", "switched_off"]]);
});

test("a saved run keeps summaries only and re-executes to the same results", async () => {
  const { data, profile, plan, results } = await runFixture();
  const executed = { profile, results, steps: [], changes: [] };
  const content = session.buildRecordContent({ source: { name: "fixture.csv", size: 1, rows: data.rows.length, columns: data.headers.length, headers: data.headers, content_hash: "", stored: true }, executed, plan, settings: types.DEFAULT_SETTINGS, createdAt: "2026-11-22T10:00:00Z" });
  const cards = content.results.flatMap((t) => t.cards);
  assert.ok(cards.every((c) => !("records" in c) && !("detail" in c)), "exception lists and detail objects are not saved");
  assert.ok(cards.every((c) => c.examples.length <= 20));
  assert.ok(JSON.stringify(content).length < 200000);
  assert.match(content.report_markdown, /^# Data quality report — fixture\.csv/);
  for (const heading of ["## Findings", "## Tests without findings", "## Not tested", "## Columns", "## Settings"]) assert.ok(content.report_markdown.includes(heading), heading);

  const replayed = await session.replayRun({ ...content, id: "x", created_at: "" }, csv.parseCsv(fixture(), "fixture.csv"));
  assert.deepEqual(replayed.results.totals, results.totals);
  assert.deepEqual(replayed.results.tests.map((t) => t.cards.map((c) => [c.testId, c.exceptions])), results.tests.map((t) => t.cards.map((c) => [c.testId, c.exceptions])));
});

test("both bundled sample files run end to end within a few seconds", async () => {
  for (const [file, expect] of [["sample_invoices.csv", ["uniqueness.key", "invoice_number"]], ["sample_materials.csv", ["completeness.blank", "ean"]]]) {
    const bytes = readFileSync(new URL(`../public/sample-data/${file}`, import.meta.url));
    const { data } = session.readSource(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), file);
    const started = performance.now();
    const profile = profileMod.buildProfile(data, types.DEFAULT_SETTINGS);
    const results = await runner.runPlan(data, profile, runner.buildStandardPlan(profile, types.DEFAULT_SETTINGS), types.DEFAULT_SETTINGS);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 8000, `${file} took ${Math.round(elapsed)} ms`);
    const card = results.tests.find((t) => t.template === expect[0]).cards.find((c) => c.subject === expect[1]);
    assert.ok(card.exceptions > 0, `${file}: ${expect.join(" / ")} finds the seeded issues`);
  }
});
