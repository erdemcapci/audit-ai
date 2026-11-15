import { isMissing, parseNumber, type Dataset } from "./csv";

/*
 * Character-pattern discovery, in two stages. Everything here is deterministic and every
 * automatic decision carries the numbers and the plain-language reason behind it.
 *
 *   Stage 1  profileDataset  – lightweight: profiles a sample of rows per column, judges whether the
 *                              column has a structure worth testing and whether a grouping column helps.
 *   Stage 2  analyzeDataset  – targeted: runs the anomaly test on every row of the selected columns.
 *
 * A value becomes a pattern key: letter -> L, digit -> N, anything else -> S ("AB-12" => "L-L-S-N-N").
 */

export const PROFILE_SAMPLE = 5000;
export const DEFAULT_THRESHOLD_PERCENT = 3;
export const GROUPING_MIN_IMPROVEMENT = 0.15;
const GROUPING_MIN_EXPLAINED_SHARE = 0.005; // grouping must also be able to explain >= 0.5% of all records ...
const GROUPING_MIN_EXPLAINED_OF_FLAGGED = 0.25; // ... and a quarter of the records that look unusual overall
const COMMON_SHARE = 0.02; // a pattern held by >= 2% of a group is a "common" (legitimate) format
const MIN_GROUP_SIZE = 10; // below this a group is too small to establish a standard
const SMALL_GROUP_SIZE = 100; // below this a 1% threshold cannot flag even a single record
const MAX_GROUPS = 50;
const EXPLAIN_MIN_GROUP = 50; // smaller groups are too thin to vouch for a format when judging a grouping
const MIN_ROWS_PER_GROUP = 30;
const MAX_STORED_RECORDS = 100000;
const RARE_SAMPLES = 100;
const COMMON_SAMPLES = 10;

export type Verdict = "suitable" | "review" | "unsuitable";
export type Priority = "high" | "medium" | "low" | "clean";

export type GroupingEvaluation = {
  column: string;
  groups: number;
  avgGroupSize: number;
  /** Share of values using the single most common pattern, with and without grouping. */
  ungrouped: number;
  grouped: number;
  improvement: number;
  /** Records that look rare overall, and how many of those are ordinary within their own group. */
  flaggedBefore: number;
  explained: number;
};

export type ColumnProfile = {
  column: string;
  index: number;
  rows: number;
  blank: number;
  blankPercent: number;
  distinctValues: number;
  uniqueValuePercent: number;
  distinctPatterns: number;
  topPattern: string;
  /** Share held by the most common pattern, within the chosen grouping when there is one. */
  dominance: number;
  /** Share of values whose pattern is common (>= 2%) within its group. */
  commonCoverage: number;
  commonPatterns: number;
  isMeasure: boolean;
  examples: string[];
  groupings: GroupingEvaluation[];
  grouping: GroupingEvaluation | null;
  groupingNote: string;
  verdict: Verdict;
  reasons: string[];
};

export type PatternStat = { pattern: string; count: number; rare: number; share: number };
export type GroupStatus = "assessed" | "too-small" | "no-standard";
export type SampleRecord = { row: number; value: string };
export type GroupPattern = {
  pattern: string;
  /** "rare" = flagged as non-standard for the group, "blank" = no value, otherwise "common". */
  kind: "common" | "rare" | "blank";
  count: number;
  share: number;
  /** Example records straight from the data: up to 100 for rare/blank patterns, 10 for common ones. */
  samples: SampleRecord[];
};
export type GroupStat = {
  group: string;
  status: GroupStatus;
  records: number;
  topPattern: string;
  topShare: number;
  patternCount: number;
  anomalies: number;
  /** Patterns at or below this share of the group were flagged. */
  cutoffPercent: number;
  note: string;
  patterns: GroupPattern[];
};
export type AnomalyRecord = {
  row: number;
  kind: "rare" | "blank";
  value: string;
  group: string;
  pattern: string;
  patternShare: number;
  usualPattern: string;
  usualShare: number;
};
export type Finding = {
  column: string;
  group: string | null;
  groupNote: string;
  records: number;
  blank: number;
  assessed: number;
  anomalies: number;
  anomalyPercent: number;
  priority: Priority;
  patterns: PatternStat[];
  groups: GroupStat[];
  anomalyRecords: AnomalyRecord[];
  recordsCapped: boolean;
};

export type Options = {
  thresholdPercent: number;
  keepSpecial: boolean;
  /** Per column: true/false forces inclusion/exclusion, otherwise the automatic verdict decides. */
  include: Record<string, boolean>;
  /** Per column: "none", or a column name; otherwise the automatic choice applies. */
  group: Record<string, string>;
};
export const DEFAULT_OPTIONS: Options = { thresholdPercent: DEFAULT_THRESHOLD_PERCENT, keepSpecial: false, include: {}, group: {} };

export type Analysis = {
  findings: Finding[];
  /** Profiles of columns that were not analysed, with the reasons. */
  excluded: ColumnProfile[];
  anomalousRecords: number;
};

export function toPatternKey(value: string, keepSpecial = false): string {
  return Array.from(value.trim()).map((ch) => (/\p{L}/u.test(ch) ? "L" : /\p{Nd}/u.test(ch) ? "N" : keepSpecial ? ch : "S")).join("-");
}

const pct = (share: number) => `${(share * 100).toFixed(share >= 0.995 || share === 0 ? 0 : 1)}%`;
const groupLabel = (value: string) => (isMissing(value) ? "(blank)" : value.trim());

function sampleIndexes(total: number) {
  if (total <= PROFILE_SAMPLE) return Array.from({ length: total }, (_, i) => i);
  const stride = total / PROFILE_SAMPLE;
  return Array.from({ length: PROFILE_SAMPLE }, (_, i) => Math.floor(i * stride));
}

function tally(keys: string[]) {
  const counts = new Map<string, number>();
  keys.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  return counts;
}

/** Per-group pattern counts for aligned arrays. A null pattern (blank value) is skipped. */
function groupedCounts(patterns: (string | null)[], groups: string[] | null) {
  const byGroup = new Map<string, Map<string, number>>();
  patterns.forEach((p, k) => {
    if (p === null) return;
    const g = groups ? groups[k] : "";
    const counts = byGroup.get(g) ?? new Map<string, number>();
    counts.set(p, (counts.get(p) ?? 0) + 1);
    byGroup.set(g, counts);
  });
  return byGroup;
}

function consistency(byGroup: Map<string, Map<string, number>>) {
  let total = 0, top = 0, common = 0, maxCommon = 0;
  byGroup.forEach((counts) => {
    const size = [...counts.values()].reduce((a, b) => a + b, 0);
    total += size;
    top += Math.max(...counts.values());
    let commonHere = 0;
    counts.forEach((count) => { if (count / size >= COMMON_SHARE) { common += count; commonHere++; } });
    maxCommon = Math.max(maxCommon, commonHere);
  });
  return { dominance: total ? top / total : 0, commonCoverage: total ? common / total : 0, maxCommon, total };
}

type Base = {
  header: string;
  index: number;
  raw: string[];
  patterns: (string | null)[];
  blank: number;
  distinctValues: number;
  distinctPatterns: number;
  topPattern: string;
  dominance: number;
  isMeasure: boolean;
  isCategorical: boolean;
  examples: string[];
  eligibleAsGroup: boolean;
  /** Records whose pattern is rare across the whole column (sample). */
  flaggedUngrouped: number;
  presentCount: number;
  rarePatterns: Set<string>;
};

function baseProfile(data: Dataset, sample: number[], index: number, keepSpecial: boolean): Base {
  const raw = sample.map((i) => data.rows[i][index]);
  const present = raw.filter((v) => !isMissing(v));
  const patterns = raw.map((v) => (isMissing(v) ? null : toPatternKey(v, keepSpecial)));
  const patternCounts = tally(patterns.filter((p): p is string => p !== null));
  const topPattern = [...patternCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const dominance = present.length ? (patternCounts.get(topPattern) ?? 0) / present.length : 0;
  const distinctValues = new Set(present.map((v) => v.trim())).size;
  const lengths = tally(present.map((v) => String(v.trim().length)));
  const topLengthShare = present.length ? Math.max(...lengths.values(), 0) / present.length : 0;
  const numericShare = present.length ? present.filter((v) => parseNumber(v) !== null).length / present.length : 0;
  const decimalShare = present.length ? present.filter((v) => /\.\d+%?$|,\d{1,2}%?$/.test(v.trim())).length / present.length : 0;
  // Amounts, quantities, percentages, running numbers: digits whose length only reflects magnitude, so
  // their "pattern" is not a format. Decimals qualify outright. Whole numbers qualify when their lengths
  // form an unbroken run (1,2,3 digits…), they carry no leading zeros and no single length dominates —
  // unlike identifiers, which have a fixed length or jump between formats (8 vs 10 digits).
  const lengthList = [...lengths.keys()].map(Number).sort((a, b) => a - b);
  const contiguousLengths = lengthList.length >= 2 && lengthList[lengthList.length - 1] - lengthList[0] + 1 === lengthList.length;
  const leadingZeros = present.length ? present.filter((v) => /^0\d/.test(v.trim())).length / present.length : 0;
  const magnitudeLike = contiguousLengths && leadingZeros < 0.05 && topLengthShare < 0.95;
  const isMeasure = numericShare >= 0.9 && (decimalShare >= 0.5 || magnitudeLike);
  const lowCardinality = distinctValues >= 2 && distinctValues <= MAX_GROUPS && distinctValues <= present.length / MIN_ROWS_PER_GROUP;
  const rareShare = DEFAULT_THRESHOLD_PERCENT / 100;
  const rarePatterns = new Set([...patternCounts.entries()].filter(([, count]) => present.length && count / present.length <= rareShare).map(([pattern]) => pattern));
  const flaggedUngrouped = [...rarePatterns].reduce((n, pattern) => n + (patternCounts.get(pattern) ?? 0), 0);
  const blank = data.rows.reduce((n, r) => n + (isMissing(r[index]) ? 1 : 0), 0);
  return {
    header: data.headers[index],
    index,
    raw,
    patterns,
    blank,
    distinctValues,
    distinctPatterns: patternCounts.size,
    topPattern,
    dominance,
    isMeasure,
    isCategorical: lowCardinality && dominance < 0.9,
    examples: [...new Set(present.map((v) => v.trim()))].slice(0, 3),
    eligibleAsGroup: lowCardinality && !isMeasure && (raw.length - present.length) / raw.length < 0.2,
    flaggedUngrouped,
    presentCount: present.length,
    rarePatterns
  };
}

function evaluateGrouping(target: Base, candidate: Base, scale: number): GroupingEvaluation {
  const labels = candidate.raw.map(groupLabel);
  const byGroup = groupedCounts(target.patterns, labels);
  const grouped = consistency(byGroup);
  // How many of the records that look rare overall are ordinary inside their own group? Groups that
  // would be small in the full data stay flagged, so tiny groups cannot "explain" anything by luck.
  let flaggedAfter = 0;
  byGroup.forEach((counts) => {
    const size = [...counts.values()].reduce((a, b) => a + b, 0);
    counts.forEach((count, pattern) => {
      if (size * scale >= EXPLAIN_MIN_GROUP ? count / size <= DEFAULT_THRESHOLD_PERCENT / 100 : target.rarePatterns.has(pattern)) flaggedAfter += count;
    });
  });
  return {
    column: candidate.header,
    groups: byGroup.size,
    avgGroupSize: 0,
    ungrouped: target.dominance,
    grouped: grouped.dominance,
    improvement: grouped.dominance - target.dominance,
    flaggedBefore: target.flaggedUngrouped,
    explained: target.flaggedUngrouped - flaggedAfter
  };
}

/** Stage 1. Profiles a deterministic sample of rows; blank counts use every row. */
export function profileDataset(data: Dataset, keepSpecial: boolean): ColumnProfile[] {
  const sample = sampleIndexes(data.rows.length);
  const scale = sample.length ? data.rows.length / sample.length : 1; // sample records represent this many rows each
  const bases = data.headers.map((_, index) => baseProfile(data, sample, index, keepSpecial));
  return bases.map((base) => {
    const blankPercent = data.rows.length ? (base.blank / data.rows.length) * 100 : 100;
    const present = base.patterns.filter((p) => p !== null).length;
    const reasons: string[] = [];
    const common = {
      column: base.header,
      index: base.index,
      rows: data.rows.length,
      blank: base.blank,
      blankPercent,
      distinctValues: base.distinctValues,
      uniqueValuePercent: present ? (base.distinctValues / present) * 100 : 0,
      distinctPatterns: base.distinctPatterns,
      topPattern: base.topPattern,
      isMeasure: base.isMeasure,
      examples: base.examples
    };
    const excluded = (reason: string): ColumnProfile => ({
      ...common, dominance: base.dominance, commonCoverage: 0, commonPatterns: 0, groupings: [], grouping: null,
      groupingNote: "", verdict: "unsuitable", reasons: [reason]
    });

    if (blankPercent >= 95) return excluded(`${blankPercent.toFixed(1)}% of values are blank — nothing to compare.`);
    if (base.distinctValues <= 1) return excluded("Every value is identical, so there is no pattern variation to test.");
    if (base.isMeasure) return excluded("Numeric measure (amounts, quantities): the digit pattern only reflects magnitude, not a format.");
    if (base.isCategorical) return excluded(`Category label: only ${base.distinctValues} distinct values, spelled in different shapes — patterns describe wording, not structure.`);

    // Which grouping, if any, makes the column's patterns meaningfully more consistent?
    //  (a) it lifts the share held by the most common pattern by >= 15 points, or
    //  (b) it explains the unusual records: formats that look rare overall but are normal in their group.
    let groupings: GroupingEvaluation[] = [];
    let grouping: GroupingEvaluation | null = null;
    let groupingNote = "";
    if (base.distinctPatterns > 1) {
      groupings = bases
        .filter((c) => c.index !== base.index && c.eligibleAsGroup)
        .map((c) => {
          const evaluation = evaluateGrouping(base, c, scale);
          return { ...evaluation, avgGroupSize: evaluation.groups ? present / evaluation.groups : 0 };
        })
        .sort((a, b) => b.improvement - a.improvement);
      const lifts = groupings.find((e) => e.improvement >= GROUPING_MIN_IMPROVEMENT && e.grouped >= 0.8);
      const explains = groupings
        .filter((e) => e.avgGroupSize * scale >= SMALL_GROUP_SIZE && e.flaggedBefore > 0 && e.explained >= GROUPING_MIN_EXPLAINED_OF_FLAGGED * e.flaggedBefore && e.explained / present >= GROUPING_MIN_EXPLAINED_SHARE)
        .sort((a, b) => b.explained - a.explained)[0];
      if (lifts) {
        grouping = lifts;
        groupingNote = `Grouped by “${lifts.column}”: the most common pattern covers ${pct(lifts.grouped)} within groups vs ${pct(lifts.ungrouped)} overall (${lifts.groups} groups, ~${Math.round(lifts.avgGroupSize).toLocaleString()} records each).`;
      } else if (explains) {
        grouping = explains;
        groupingNote = `Grouped by “${explains.column}”: ${Math.round((explains.explained / explains.flaggedBefore) * 100)}% of the records that look unusual overall follow a format that is normal for their “${explains.column}” group.`;
      }
    }
    if (!grouping) {
      const best = groupings[0];
      groupingNote = base.dominance >= 0.95
        ? `Already consistent without grouping (${pct(base.dominance)} use one pattern).`
        : best
          ? `No grouping applied: the best candidate (“${best.column}”) does not make patterns meaningfully more consistent.`
          : "No grouping applied: no column has a suitable number of groups.";
    }

    const labels = grouping ? bases[data.headers.indexOf(grouping.column)].raw.map(groupLabel) : null;
    const stats = consistency(groupedCounts(base.patterns, labels));
    const dominance = stats.dominance;
    let verdict: Verdict;
    if (stats.commonCoverage < 0.75) {
      verdict = "unsuitable";
      reasons.push(`No repeating structure: only ${pct(stats.commonCoverage)} of values share a format with ≥ ${COMMON_SHARE * 100}% of their group — typical of free text, names or random codes (UUIDs, hashes).`);
    } else if (stats.commonCoverage < 0.95 || stats.maxCommon > 12 || dominance < 0.5) {
      verdict = "review";
      if (stats.commonCoverage < 0.95) reasons.push(`Only ${pct(stats.commonCoverage)} of values follow a common pattern.`);
      if (stats.maxCommon > 12) reasons.push(`${stats.maxCommon} different patterns are each common — the format may not be standardised.`);
      if (dominance < 0.5) reasons.push(`No dominant pattern (most common covers ${pct(dominance)}). Several legitimate formats, or no standard.`);
    } else {
      verdict = "suitable";
      reasons.push(
        base.distinctValues / Math.max(present, 1) > 0.5
          ? `Identifier-like: ${pct(base.distinctValues / present)} of values are unique, yet they follow only ${base.distinctPatterns} pattern${base.distinctPatterns === 1 ? "" : "s"} — uniqueness is expected and not penalised.`
          : `Structured: ${pct(stats.commonCoverage)} of values follow ${stats.maxCommon} common pattern${stats.maxCommon === 1 ? "" : "s"}.`
      );
    }
    return { ...common, dominance, commonCoverage: stats.commonCoverage, commonPatterns: stats.maxCommon, groupings, grouping, groupingNote, verdict, reasons };
  });
}

function priorityOf(anomalies: number, percent: number): Priority {
  if (!anomalies) return "clean";
  if (percent >= 0.5 || anomalies >= 100) return "high";
  if (percent >= 0.1 || anomalies >= 10) return "medium";
  return "low";
}
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, clean: 3 };

/** Stage 2. Full-data anomaly test for one column, optionally within groups. */
export function analyzeColumn(data: Dataset, profile: ColumnProfile, groupColumn: string | null, groupNote: string, options: Options): Finding {
  const c = profile.index;
  const g = groupColumn ? data.headers.indexOf(groupColumn) : -1;
  const threshold = options.thresholdPercent / 100;
  type Entry = { row: number; value: string; group: string; pattern: string };
  const entries: Entry[] = [];
  const anomalyRecords: AnomalyRecord[] = [];
  let anomalies = 0;
  let blank = 0;
  let capped = false;
  const store = (record: AnomalyRecord) => {
    if (anomalyRecords.length < MAX_STORED_RECORDS) anomalyRecords.push(record);
    else capped = true;
  };

  const blankByGroup = new Map<string, { count: number; samples: SampleRecord[] }>();
  data.rows.forEach((r, i) => {
    const group = g >= 0 ? groupLabel(r[g]) : "(all records)";
    if (isMissing(r[c])) {
      blank++;
      const entry = blankByGroup.get(group) ?? { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < RARE_SAMPLES) entry.samples.push({ row: i + 2, value: r[c] });
      blankByGroup.set(group, entry);
      store({ row: i + 2, kind: "blank", value: r[c], group, pattern: "(blank)", patternShare: 0, usualPattern: "", usualShare: 0 });
    } else entries.push({ row: i + 2, value: r[c], group, pattern: toPatternKey(r[c], options.keepSpecial) });
  });

  const byGroup = new Map<string, Map<string, number>>();
  const samples = new Map<string, SampleRecord[]>(); // keyed by group + pattern
  const sampleKey = (group: string, pattern: string) => `${group}\u0000${pattern}`;
  entries.forEach((e) => {
    const counts = byGroup.get(e.group) ?? new Map<string, number>();
    counts.set(e.pattern, (counts.get(e.pattern) ?? 0) + 1);
    byGroup.set(e.group, counts);
    const key = sampleKey(e.group, e.pattern);
    const list = samples.get(key) ?? [];
    if (list.length < RARE_SAMPLES) list.push({ row: e.row, value: e.value });
    samples.set(key, list);
  });
  const rule = new Map<string, { status: GroupStatus; cutoff: number; size: number; top: string; topCount: number }>();
  const groups: GroupStat[] = [];
  byGroup.forEach((counts, group) => {
    const size = [...counts.values()].reduce((a, b) => a + b, 0);
    const [topPattern, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const stats = consistency(new Map([[group, counts]]));
    let status: GroupStatus = "assessed";
    let cutoff = threshold;
    let note = "";
    if (size < MIN_GROUP_SIZE) {
      status = "too-small";
      note = `Only ${size} records — too few to establish a standard, not assessed.`;
    } else if (topCount / size < 0.5 && stats.commonCoverage < 0.8) {
      status = "no-standard";
      note = "No pattern dominates this group, so nothing is flagged as non-standard. Review the patterns manually.";
    } else if (size < SMALL_GROUP_SIZE && 1 / size > threshold) {
      if (topCount / size >= 0.9) {
        cutoff = 1 / size;
        note = `Small group (${size} records): a ${options.thresholdPercent}% threshold cannot flag one record, so single-record patterns are flagged because ${pct(topCount / size)} follow one pattern.`;
      } else note = `Small group (${size} records): the ${options.thresholdPercent}% threshold cannot flag any record, and no pattern dominates enough to flag single records.`;
    }
    rule.set(group, { status, cutoff, size, top: topPattern, topCount });
    groups.push({ group, status, records: size, topPattern, topShare: topCount / size, patternCount: counts.size, anomalies: 0, cutoffPercent: cutoff * 100, note, patterns: [] });
  });

  const globalPatterns = new Map<string, { count: number; rare: number }>();
  const groupStat = new Map(groups.map((s) => [s.group, s]));
  entries.forEach((e) => {
    const r = rule.get(e.group)!;
    const count = byGroup.get(e.group)!.get(e.pattern)!;
    const share = count / r.size;
    const rare = r.status === "assessed" && share <= r.cutoff + 1e-12;
    const stat = globalPatterns.get(e.pattern) ?? { count: 0, rare: 0 };
    stat.count++;
    if (rare) {
      stat.rare++;
      anomalies++;
      groupStat.get(e.group)!.anomalies++;
      store({ row: e.row, kind: "rare", value: e.value, group: e.group, pattern: e.pattern, patternShare: share, usualPattern: r.top, usualShare: r.topCount / r.size });
    }
    globalPatterns.set(e.pattern, stat);
  });

  groups.forEach((stat) => {
    const r = rule.get(stat.group)!;
    stat.patterns = [...byGroup.get(stat.group)!.entries()].map(([pattern, count]) => {
      const rare = r.status === "assessed" && count / r.size <= r.cutoff + 1e-12;
      const list = samples.get(sampleKey(stat.group, pattern)) ?? [];
      return { pattern, kind: rare ? "rare" as const : "common" as const, count, share: count / r.size, samples: rare ? list : list.slice(0, COMMON_SAMPLES) };
    }).sort((a, b) => b.count - a.count);
  });
  // Blank values have no pattern; show them next to the rare patterns of their group.
  blankByGroup.forEach((blanks, group) => {
    const stat = groupStat.get(group);
    if (stat) stat.patterns.push({ pattern: "(blank)", kind: "blank", count: blanks.count, share: 0, samples: blanks.samples });
  });

  const assessed = groups.filter((s) => s.status === "assessed").reduce((n, s) => n + s.records, 0);
  const anomalyPercent = assessed ? (anomalies / assessed) * 100 : 0;
  anomalyRecords.sort((a, b) => a.row - b.row);
  return {
    column: profile.column,
    group: groupColumn,
    groupNote,
    records: data.rows.length,
    blank,
    assessed,
    anomalies,
    anomalyPercent,
    priority: priorityOf(anomalies, anomalyPercent),
    patterns: [...globalPatterns.entries()].map(([pattern, s]) => ({ pattern, count: s.count, rare: s.rare, share: entries.length ? s.count / entries.length : 0 })).sort((a, b) => b.count - a.count),
    groups: groups.sort((a, b) => b.anomalies - a.anomalies || b.records - a.records),
    anomalyRecords,
    recordsCapped: capped
  };
}

/** Applies overrides on top of the automatic verdicts and runs the targeted analysis. */
export function analyzeDataset(data: Dataset, profiles: ColumnProfile[], options: Options): Analysis {
  const findings: Finding[] = [];
  const excluded: ColumnProfile[] = [];
  profiles.forEach((profile) => {
    const include = options.include[profile.column] ?? profile.verdict === "suitable";
    if (!include) { excluded.push(profile); return; }
    const override = options.group[profile.column];
    let groupColumn = profile.grouping?.column ?? null;
    let note = profile.groupingNote;
    if (override === "none") { groupColumn = null; note = "Grouping switched off manually."; }
    else if (override && data.headers.includes(override) && override !== profile.column) { groupColumn = override; note = `Grouped by “${override}” (manual selection).`; }
    findings.push(analyzeColumn(data, profile, groupColumn, note, options));
  });
  findings.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.anomalyPercent - a.anomalyPercent || b.anomalies - a.anomalies);
  return { findings, excluded, anomalousRecords: findings.reduce((n, f) => n + f.anomalies, 0) };
}
