import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

/*
 * Relationship discovery and dataset rules. A synthetic file where related columns agree except for
 * a few seeded rows: discovery must propose the rules, and each rule must find exactly those rows.
 */

let server, csv, profileMod, runner, rules, session, types;
before(async () => {
  server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, ws: false }, appType: "custom" });
  const load = (path) => server.ssrLoadModule(`/src/features/data-quality/engine/${path}`);
  [csv, profileMod, runner, rules, session, types] = await Promise.all(["csv.ts", "profile.ts", "runner.ts", "rules.ts", "session.ts", "types.ts"].map(load));
});
after(async () => { await server?.close(); });

const iso = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const money = (n) => n.toFixed(2);

function fixture() {
  const start = Date.UTC(2024, 0, 1) / 86400000;
  const rows = [];
  for (let i = 0; i < 600; i++) {
    const vendor = `V${String((i % 40) + 1).padStart(3, "0")}`;
    const doc = start + i;
    const closed = i % 3 === 0;
    const net = 100 + ((i * 13) % 500) + 0.5;
    const tax = Math.round(net * 20) / 100;
    const qty = (i % 40) + 1;
    const price = 10 + (i % 17) + 0.25;
    rows.push({
      vendor_id: vendor,
      vendor_name: `Vendor ${vendor}`,
      doc_date: iso(doc),
      post_date: iso(doc + (i % 5)),
      status: closed ? "Closed" : "Open",
      close_date: closed ? iso(doc + (i % 5)) : "",
      net: money(net),
      tax: money(tax),
      gross: money(net + tax),
      qty: String(qty),
      price: money(price),
      amount: money(qty * price)
    });
  }
  [5, 6, 7].forEach((i) => { rows[i].vendor_name = "Wrong Name Ltd"; }); // same vendor, other name
  [10, 11].forEach((i) => { rows[i].post_date = iso(Date.UTC(2023, 11, 1) / 86400000); }); // posted before the document date
  rows[12].close_date = ""; // closed without a close date
  rows[13].close_date = rows[13].post_date; // open with a close date
  [20, 21].forEach((i) => { rows[i].gross = money(Number(rows[i].gross) + 5); }); // does not add up
  rows[30].amount = money(Number(rows[30].amount) + 1); // does not multiply
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => r[h]).join(","))].join("\n");
}

const dependency = { kind: "dependency", from: "vendor_id", to: "vendor_name" };
const order = { kind: "compare", left: "doc_date", op: "lte", right: "post_date" };
const closedNeedsDate = { kind: "conditional", if: { column: "status", op: "eq", value: "Closed" }, then: { column: "close_date", op: "not_empty" } };
const dateMeansClosed = { kind: "conditional", if: { column: "close_date", op: "not_empty" }, then: { column: "status", op: "in", values: ["Closed"] } };
const sum = { kind: "arithmetic", formula: "sum", inputs: ["net", "tax"], result: "gross", tolerance: 0.01 };
const product = { kind: "arithmetic", formula: "product", inputs: ["qty", "price"], result: "amount", tolerance: 0.01 };

async function run(settings = types.DEFAULT_SETTINGS, extra = []) {
  const data = csv.parseCsv(fixture(), "rules.csv");
  const profile = profileMod.buildProfile(data, settings);
  const plan = [...runner.buildStandardPlan(profile, settings), ...extra];
  const results = await runner.runPlan(data, profile, plan, settings);
  const ruleCards = results.tests.find((t) => t.template === "rule").cards;
  const cardFor = (rule) => ruleCards.find((c) => c.subject === rules.ruleLabel(rule));
  return { data, profile, plan, results, ruleCards, cardFor };
}

test("discovery proposes the relationships hidden in the data, as enabled rules", async () => {
  const { profile, plan } = await run();
  const found = profile.relationships.map((r) => rules.ruleLabel(r.rule));
  for (const rule of [dependency, order, closedNeedsDate, dateMeansClosed, sum, product]) {
    assert.ok(found.includes(rules.ruleLabel(rule)), `discovered: ${rules.ruleLabel(rule)} (found: ${found.join("; ")})`);
    const proposed = plan.find((t) => t.id === rules.ruleId(rule));
    assert.equal(proposed.source, "discovered");
    assert.equal(proposed.enabled, true, "holds for >= 99% of rows, so it is switched on");
    assert.match(proposed.reason, /holds for 99\.\d% of (600|200|\d{3}) sampled rows/);
  }
  assert.ok(!found.includes(rules.ruleLabel({ kind: "dependency", from: "vendor_name", to: "vendor_id" })), "a one-to-one pair is proposed once, from the code to the name");
});

test("each rule finds exactly the seeded rows", async () => {
  const { cardFor } = await run();
  assert.equal(cardFor(dependency).exceptions, 3);
  assert.deepEqual(cardFor(dependency).examples.map((e) => e.row), [7, 8, 9]);
  assert.match(cardFor(dependency).examples[0].reason, /“V006” usually comes with “Vendor V006”/);
  assert.equal(cardFor(order).exceptions, 2);
  assert.equal(cardFor(closedNeedsDate).exceptions, 1);
  assert.equal(cardFor(dateMeansClosed).exceptions, 1);
  assert.equal(cardFor(sum).exceptions, 2);
  assert.equal(cardFor(product).exceptions, 1);
  assert.equal(cardFor(order).classification, "finding");
});

test("rule results are classified by violation rate, and only findings count as findings", async () => {
  const wrong = { kind: "compare", left: "post_date", op: "lte", right: "doc_date" }; // true only when posted on the same day
  const auditorRule = { id: rules.ruleId(wrong), template: "rule", subject: rules.ruleLabel(wrong), params: wrong, source: "auditor", reason: "Added by you.", enabled: true };
  const strict = { ...types.DEFAULT_SETTINGS, ruleFindingMaxPercent: 0.4, ruleUncertainMaxPercent: 30 };
  const { results, cardFor } = await run(strict, [auditorRule]);
  assert.equal(cardFor(wrong).classification, "rule_did_not_hold");
  assert.equal(cardFor(dependency).classification, "uncertain", "0.5% is above the 0.4% findings limit");
  assert.equal(cardFor(order).classification, "finding", "0.33% is within the limit");
  assert.equal(runner.isFinding(cardFor(dependency)), false);
  assert.equal(cardFor(closedNeedsDate).classification, "uncertain", "1 of the 200 closed rows is 0.5%");
  assert.equal(results.totals.uncertain, 3, "the dependency and both status/close-date rules");
  assert.equal(results.totals.notHeld, 1);
  const cards = results.tests.flatMap((t) => t.cards);
  assert.equal(results.totals.findings, cards.filter(runner.isFinding).length);
});

test("a higher discovery threshold proposes fewer rules", async () => {
  const loose = (await run()).profile.relationships.length;
  const strictProfile = (await run({ ...types.DEFAULT_SETTINGS, discoveryMinHoldPercent: 100 })).profile;
  assert.ok(strictProfile.relationships.length < loose);
  assert.ok(strictProfile.relationships.every((r) => r.holdRate === 1));
});

test("rules read as plain sentences and invalid rules explain why", async () => {
  const { profile } = await run();
  assert.equal(rules.ruleSentence(order, profile), "“doc_date” should be on or before “post_date”.");
  assert.equal(rules.ruleSentence(closedNeedsDate, profile), "When “status” is “Closed”, “close_date” should be filled in.");
  assert.equal(rules.ruleSentence(dependency, profile), "Each “vendor_id” should always come with the same “vendor_name”.");
  assert.deepEqual(rules.validateRule(order, profile), []);
  assert.match(rules.validateRule({ kind: "compare", left: "doc_date", op: "lte", right: "net" }, profile)[0], /date column can only be compared with another date/);
  assert.match(rules.validateRule({ kind: "arithmetic", formula: "sum", inputs: ["net", "status"], result: "gross", tolerance: 0.01 }, profile)[0], /number columns/);
  assert.match(rules.validateRule({ kind: "conditional", if: { column: "status", op: "eq", value: "" }, then: { column: "close_date", op: "not_empty" } }, profile)[0], /Enter the value/);
  assert.match(rules.validateRule({ kind: "dependency", from: "nope", to: "vendor_name" }, profile)[0], /exist in this file/);
});

test("conditions compare dates and numbers by value, text exactly", async () => {
  const { profile, data } = await run();
  const col = (name) => profile.columns.find((c) => c.name === name);
  const row = data.rows[0];
  assert.equal(rules.evaluateCondition({ column: "doc_date", op: "gte", value: "2024-01-01" }, row, col("doc_date")), true);
  assert.equal(rules.evaluateCondition({ column: "net", op: "gt", value: "1000" }, row, col("net")), false);
  assert.equal(rules.evaluateCondition({ column: "status", op: "in", values: ["Open", "Closed"] }, row, col("status")), true);
  assert.equal(rules.evaluateCondition({ column: "close_date", op: "lt", value: "2030-01-01" }, data.rows[1], col("close_date")), null, "blank values cannot be ordered");
});

test("unusual amounts carry a histogram whose bins add up to the values tested", async () => {
  const { results } = await run();
  const card = results.tests.find((t) => t.template === "accuracy.outlier").cards[0];
  const total = card.detail.bins.reduce((n, b) => n + b.count, 0);
  assert.equal(total, card.tested);
  assert.ok(card.detail.lower < card.detail.upper);
});

test("runs saved before phase 2 still replay with default rule settings", async () => {
  const { data, profile, plan, results } = await run();
  const content = session.buildRecordContent({ source: { name: "rules.csv", size: 1, rows: 600, columns: 12, headers: data.headers, content_hash: "", stored: true }, executed: { profile, results, steps: [], changes: [] }, plan, settings: types.DEFAULT_SETTINGS, createdAt: "2026-11-22T10:00:00Z" });
  assert.equal(content.profile.relationships.length, profile.relationships.length);
  const { discoveryMinHoldPercent: _d, ruleFindingMaxPercent: _f, ruleUncertainMaxPercent: _u, ...oldSettings } = types.DEFAULT_SETTINGS;
  const replayed = await session.replayRun({ ...content, settings: oldSettings, id: "x", created_at: "" }, data);
  assert.deepEqual(replayed.results.totals, results.totals);
  assert.match(content.report_markdown, /## Settings[\s\S]*Rules: up to 5% of rows/);
});
