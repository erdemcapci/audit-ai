import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

/*
 * Generic-engine checks. The data here is synthetic and independent of the sample CSV files: each
 * column is an archetype seen in real extracts, with its expected verdict and (for structured
 * columns) a known set of injected corruptions the engine must find without being told about them.
 */

let server, csv, dq;
before(async () => {
  server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, ws: false }, appType: "custom" });
  csv = await server.ssrLoadModule("/src/features/data-quality/engine/csv.ts");
  dq = await server.ssrLoadModule("/src/features/data-quality/engine/patterns.ts");
});
after(async () => { await server?.close(); });

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(Number(process.env.DQ_SEED) || 20260101);
const int = (a, b) => a + Math.floor(R() * (b - a + 1));
const digs = (n) => Array.from({ length: n }, () => int(0, 9)).join("");
const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(65 + int(0, 25))).join("");
const pick = (arr) => arr[int(0, arr.length - 1)];
const pad = (v, n) => String(v).padStart(n, "0");
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa"];

const N = 4000;
const COUNTRIES = [["DE", 0.4], ["FR", 0.28], ["GB", 0.2], ["US", 0.1], ["NL", 0.02]];
const countryOf = () => { let x = R(); for (const [c, w] of COUNTRIES) { if ((x -= w) < 0) return c; } return "DE"; };
const postal = { DE: () => digs(5), FR: () => digs(5), GB: () => `${letters(2)}${int(1, 9)} ${int(1, 9)}${letters(2)}`, US: () => `${digs(5)}-${digs(4)}`, NL: () => `${digs(4)} ${letters(2)}` };
const iban = { DE: () => "DE" + digs(20), FR: () => "FR" + digs(25), GB: () => "GB" + digs(2) + letters(4) + digs(14), US: () => "US" + digs(14), NL: () => "NL" + digs(2) + letters(4) + digs(10) };

/** name -> { make(i, country), corrupt?(v) }. A corrupt value must change the L/N/S pattern. */
const COLUMNS = {
  id_leading_zeros: { make: (i) => pad(i + 1, 7), corrupt: (v) => v.slice(1), structured: true },
  id_six_digits: { make: () => String(int(100000, 999999)), corrupt: (v) => v.slice(0, 2) + "O" + v.slice(3), structured: true },
  product_code: { make: () => `${letters(2)}-${digs(4)}`, corrupt: (v) => v.replace("-", ""), structured: true },
  date_iso: { make: () => `20${pad(int(10, 25), 2)}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`, corrupt: (v) => v.replace(/-0/g, "-"), structured: true },
  timestamp: { make: () => `2024-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)} ${pad(int(0, 23), 2)}:${pad(int(0, 59), 2)}:${pad(int(0, 59), 2)}`, corrupt: (v) => v.slice(0, 16), structured: true },
  date_dmy: { make: () => `${pad(int(1, 28), 2)}/${pad(int(1, 12), 2)}/20${pad(int(10, 25), 2)}`, corrupt: (v) => v.slice(0, 6) + v.slice(8), structured: true },
  postal_by_country: { make: (i, c) => postal[c](), corrupt: (v) => v.slice(0, -1), structured: true, grouped: "country" },
  iban_by_country: { make: (i, c) => iban[c](), corrupt: (v) => v.slice(0, -2), structured: true, grouped: "country" },
  // 98% share one format; the small country (NL) legitimately uses a longer one.
  region_code: { make: (i, c) => (c === "NL" ? `AB-${digs(4)}-X` : `AB-${digs(4)}`), corrupt: (v) => v.replace("AB-", "A-"), structured: true, grouped: "country" },
  seq_id: { make: (i) => String(i + 1), expect: "unsuitable" },
  quantity: { make: () => String(Math.max(1, Math.round(Math.exp(R() * 6.9)))), expect: "unsuitable" },
  price: { make: () => (R() * 900 + 1).toFixed(2), expect: "unsuitable" },
  price_text: { make: () => `$${int(1, 99)},${pad(int(0, 999), 3)}.${pad(int(0, 99), 2)}`, expect: "unsuitable" },
  percent: { make: () => `${(R() * 100).toFixed(1)}%`, expect: "unsuitable" },
  status: { make: () => pick(["Open", "Closed", "Pending", "On hold"]), expect: "unsuitable" },
  boolean_text: { make: () => pick(["true", "false"]), expect: "unsuitable" },
  uuid: { make: () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`, expect: "not-suitable" },
  person_name: { make: () => `${pick(WORDS)} ${pick(WORDS)}${letters(int(0, 6)).toLowerCase()}`, expect: "unsuitable" },
  email: { make: () => `${pick(WORDS)}${letters(int(0, 6)).toLowerCase()}@${pick(WORDS)}.com`, expect: "not-suitable" },
  description: { make: () => Array.from({ length: int(2, 7) }, () => pick(WORDS)).join(" "), expect: "unsuitable" },
  mostly_blank: { make: () => (R() < 0.97 ? "" : "x1"), expect: "unsuitable" },
  constant: { make: () => "SAME", expect: "unsuitable" },
  yes_no: { make: () => pick(["Y", "N"]) },
  phone_two_formats: { make: () => (R() < 0.85 ? `+49 30 ${digs(7)}` : `030 ${digs(7)}`) }
};

const INJECT = 0.01;
function buildDataset() {
  const countries = Array.from({ length: N }, countryOf);
  const injected = {}; // column -> Set of file rows (1-based incl. header)
  const cols = Object.entries(COLUMNS).map(([name, spec]) => {
    injected[name] = new Set();
    return countries.map((c, i) => {
      const v = spec.make(i, c);
      if (spec.corrupt && R() < INJECT) {
        const bad = spec.corrupt(v);
        if (bad !== v) { injected[name].add(i + 2); return bad; } // only count real changes
      }
      return v;
    });
  });
  const lines = [["country", ...Object.keys(COLUMNS)].join(",")];
  for (let i = 0; i < N; i++) lines.push([countries[i], ...cols.map((c) => c[i])].map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","));
  return { data: csv.parseCsv(lines.join("\n"), "battery"), injected };
}

test("every archetype gets a sensible verdict without any configuration", () => {
  const { data } = buildDataset();
  const profiles = Object.fromEntries(dq.profileDataset(data, false).map((p) => [p.column, p]));
  const failures = [];
  for (const [name, spec] of Object.entries(COLUMNS)) {
    const v = profiles[name].verdict;
    if (spec.structured && v !== "suitable") failures.push(`${name}: expected suitable, got ${v} (${profiles[name].reasons[0]})`);
    if (spec.expect === "unsuitable" && v !== "unsuitable") failures.push(`${name}: expected unsuitable, got ${v} (${profiles[name].reasons[0]})`);
    if (spec.expect === "not-suitable" && v === "suitable") failures.push(`${name}: must not be suitable`);
  }
  assert.deepEqual(failures, []);
});

test("injected corruptions are found with high recall and precision, and legitimate formats are left alone", () => {
  const { data, injected } = buildDataset();
  const profiles = dq.profileDataset(data, false);
  const { findings } = dq.analyzeDataset(data, profiles, dq.DEFAULT_OPTIONS);
  const failures = [];
  for (const [name, spec] of Object.entries(COLUMNS)) {
    if (!spec.structured) continue;
    const f = findings.find((x) => x.column === name);
    if (!f) { failures.push(`${name}: not analysed`); continue; }
    if (spec.grouped && f.group !== spec.grouped) failures.push(`${name}: expected grouping by ${spec.grouped}, got ${f.group}`);
    const flagged = new Set(f.anomalyRecords.filter((r) => r.kind === "rare").map((r) => r.row));
    // In a group of fewer than 100 records a corrupted pattern seen 3+ times is >3% of the group, i.e. by
    // definition not rare, so recall is only measured where the threshold can work.
    const rowsPerCountry = {};
    data.rows.forEach((r) => { rowsPerCountry[r[0]] = (rowsPerCountry[r[0]] ?? 0) + 1; });
    const truth = new Set([...injected[name]].filter((row) => !spec.grouped || rowsPerCountry[data.rows[row - 2][0]] >= 100));
    const hits = [...truth].filter((r) => flagged.has(r)).length;
    const recall = truth.size ? hits / truth.size : 1;
    const precision = flagged.size ? hits / flagged.size : 1;
    if (recall < 0.9) failures.push(`${name}: recall ${(recall * 100).toFixed(0)}% (${hits}/${truth.size})`);
    if (precision < 0.9) failures.push(`${name}: precision ${(precision * 100).toFixed(0)}% (${hits}/${flagged.size})`);
  }
  for (const name of ["yes_no", "phone_two_formats"]) {
    const f = findings.find((x) => x.column === name);
    if (f && f.anomalies > 0) failures.push(`${name}: legitimate formats flagged (${f.anomalies})`);
  }
  assert.deepEqual(failures, []);
});

test("degenerate inputs never throw", () => {
  for (const text of ["", "a", "a,b", "a,b\n", "a,b\n1,2", "a,a,a\n1,2,3\n4,5,6", ",,\n1,2,3", "x\n\n\n", "a,b\n,\n,\n"]) {
    const data = csv.parseCsv(text, "edge");
    const profiles = dq.profileDataset(data, false);
    dq.analyzeDataset(data, profiles, dq.DEFAULT_OPTIONS);
  }
});

test("duplicate and blank headers are made unique so columns are never confused", () => {
  const data = csv.parseCsv("id,id,,id\n1,2,3,4");
  assert.equal(new Set(data.headers).size, 4);
});

test("legacy single-byte exports decode correctly instead of turning umlauts into special characters", () => {
  const latin1 = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // "Müller" in windows-1252
  assert.equal(csv.decodeText(latin1.buffer), "Müller");
  const utf8 = new TextEncoder().encode("Müller");
  assert.equal(csv.decodeText(utf8.buffer), "Müller");
});

test("a few hundred thousand rows analyse in a reasonable time", () => {
  const lines = ["id,country,code,amount"];
  for (let i = 0; i < 300000; i++) lines.push(`${pad(i, 8)},${i % 7 === 0 ? "DE" : "FR"},${i % 7 === 0 ? "D-" + pad(i % 9999, 4) : "F" + pad(i % 99999, 5)},${(i % 977) + 0.5}`);
  const data = csv.parseCsv(lines.join("\n"));
  const t = performance.now();
  const analysis = dq.analyzeDataset(data, dq.profileDataset(data, false), dq.DEFAULT_OPTIONS);
  assert.ok(analysis.findings.length >= 2);
  assert.ok(performance.now() - t < 15000, `took ${Math.round(performance.now() - t)}ms`);
});
