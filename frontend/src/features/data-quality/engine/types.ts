import type { Dataset } from "./csv";
import type { DecimalMark } from "./numbers";
import type { ColumnProfile, Priority } from "./patterns";

/*
 * Shared contracts of the data quality engine. A template is pre-written test code; a test definition
 * is a template plus parameters. Standard tests and (later) AI or auditor rules are the same thing and
 * differ only in `source`. Everything here is deterministic: the same plan on the same data gives the
 * same results, which is why a saved run can be re-executed from its stored source file.
 */

export type Severity = Priority;

export type TechnicalType = "identifier" | "category" | "measure" | "date" | "boolean" | "free_text" | "constant" | "empty";

export type Dimension = "completeness" | "validity" | "uniqueness" | "accuracy" | "consistency";

export type DateFormat =
  | "yyyy-MM-dd" | "yyyy/MM/dd" | "dd.MM.yyyy" | "dd/MM/yyyy" | "MM/dd/yyyy" | "dd-MM-yyyy"
  | "d-MMM-yyyy" | "yyyyMMdd" | "dd.MM.yy" | "dd/MM/yy" | "MM/dd/yy";

export type ValueCount = { value: string; count: number };

export type DateInfo = {
  format: DateFormat;
  /** Other formats that read the values equally well (e.g. dd/MM vs MM/dd when every day is <= 12). */
  alternatives: DateFormat[];
  parsedShare: number;
  min: string;
  max: string;
  weekendShare: number;
};

export type MeasureInfo = {
  /** Decimal mark of this column ("1.234,56" uses ","). Missing in runs saved before it existed: ".". */
  decimal?: DecimalMark;
  parsedShare: number;
  min: number;
  max: number;
  median: number;
  negativeShare: number;
  positiveShare: number;
};

export type ColumnInfo = {
  name: string;
  index: number;
  type: TechnicalType;
  typeReason: string;
  rows: number;
  blank: number;
  blankPercent: number;
  /** Distinct non-blank values and their share of non-blank values, measured on the profile sample. */
  distinct: number;
  uniquePercent: number;
  topValues: ValueCount[];
  examples: string[];
  date?: DateInfo;
  measure?: MeasureInfo;
};

export type CompareOp = "lt" | "lte" | "eq" | "neq" | "gte" | "gt";

export type Condition = {
  column: string;
  op: "empty" | "not_empty" | "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte";
  /** Constant for eq/neq/gt/gte/lt/lte (dates as yyyy-MM-dd). */
  value?: string;
  /** Constants for in/not_in. */
  values?: string[];
};

/** A business rule between columns. One template runs all four kinds. */
export type RuleParams =
  | { kind: "compare"; left: string; op: CompareOp; right: string }
  | { kind: "conditional"; if: Condition; then: Condition }
  | { kind: "dependency"; from: string; to: string }
  | { kind: "arithmetic"; formula: "sum" | "product"; inputs: [string, string]; result: string; tolerance: number };

/** A relationship the code found in the profile sample; it becomes a proposed rule. */
export type Relationship = {
  rule: RuleParams;
  /** Share of the checked sample rows for which the rule holds. */
  holdRate: number;
  checked: number;
};

export type DatasetProfile = {
  rows: number;
  columns: ColumnInfo[];
  /** Stage-1 profiles of the character-pattern engine, one per column. */
  patterns: ColumnProfile[];
  relationships: Relationship[];
  /** Set when discovery had to leave columns out (very wide files) or could not run. */
  discoveryNote?: string;
};

export type RunSettings = {
  /** Blank values at or below this share of a column are reported with low severity. */
  blankThresholdPercent: number;
  patternThresholdPercent: number;
  keepSpecial: boolean;
  /** Outliers lie this many interquartile ranges outside the middle half of the values. */
  outlierFactor: number;
  /** Date formats confirmed by the auditor, per column. */
  dateFormats: Record<string, DateFormat>;
  /** A relationship is proposed as a rule when it holds for at least this share of sampled rows. */
  discoveryMinHoldPercent: number;
  /** Rule results: up to this violation rate the exceptions are findings… */
  ruleFindingMaxPercent: number;
  /** …up to this one the rule itself is uncertain; above it the rule did not hold. */
  ruleUncertainMaxPercent: number;
};

export const DEFAULT_SETTINGS: RunSettings = {
  blankThresholdPercent: 1,
  patternThresholdPercent: 3,
  keepSpecial: false,
  outlierFactor: 3,
  dateFormats: {},
  discoveryMinHoldPercent: 97,
  ruleFindingMaxPercent: 5,
  ruleUncertainMaxPercent: 30
};

/** Settings of runs saved before a field existed fall back to the defaults. */
export const withDefaults = (settings: Partial<RunSettings>): RunSettings => ({ ...DEFAULT_SETTINGS, ...settings });

export type TemplateId =
  | "completeness.blank"
  | "completeness.placeholder"
  | "validity.type"
  | "validity.pattern"
  | "validity.allowed_values"
  | "validity.range"
  | "uniqueness.key"
  | "uniqueness.row"
  | "accuracy.outlier"
  | "accuracy.calendar"
  | "rule";

export type TestSource = "standard" | "discovered" | "ai" | "auditor";

export type TestDefinition<P = Record<string, unknown>> = {
  id: string;
  template: TemplateId;
  /** Column (or "Whole dataset") the test looks at; one result card per definition. */
  subject: string;
  params: P;
  source: TestSource;
  /** Why the test is in the plan, in plain language. */
  reason: string;
  enabled: boolean;
  /** Set when the test comes from the project's saved rules. */
  savedAt?: string;
  /** What the AI review changed about this test, and why. */
  aiNote?: string;
};

/** Rule results are judged by violation rate: a wrong assumption must not look like broken data. */
export type Classification = "holds" | "finding" | "uncertain" | "rule_did_not_hold";

export type ExceptionRecord = { row: number; value: string; reason: string };

export type ResultCard = {
  testId: string;
  subject: string;
  tested: number;
  exceptions: number;
  /** Exceptions as a percentage of `tested`. */
  rate: number;
  severity: Severity;
  summary: string;
  /** Rule tests only. Uncertain and failed rules are not counted as findings. */
  classification?: Classification;
  /** First exceptions, kept in the saved run. */
  examples: ExceptionRecord[];
  facts?: Record<string, string | number>;
  /** In memory only: every exception (capped) and template-specific detail. Never saved. */
  records?: ExceptionRecord[];
  recordsCapped?: boolean;
  detail?: unknown;
};

export type TestStatus = "done" | "not_applicable" | "switched_off";

export type SkipNote = { subject: string; reason: string };

export type TestNodeResult = {
  template: TemplateId;
  title: string;
  dimension: Dimension;
  status: TestStatus;
  cards: ResultCard[];
  notes: SkipNote[];
  durationMs: number;
};

export type RunTotals = {
  tests: number;
  findings: number;
  high: number;
  medium: number;
  low: number;
  exceptions: number;
  /** Rules to confirm, and rules whose assumption did not hold (not findings). */
  uncertain: number;
  notHeld: number;
};

export type Verdict = "no_issues" | "issues_to_review" | "significant_issues";

export type RunResults = { tests: TestNodeResult[]; totals: RunTotals; verdict: Verdict };

export type RunStep = {
  id: string;
  kind: "file" | "code" | "auditor" | "ai";
  title: string;
  startedAt: string;
  durationMs: number;
  detail: Record<string, unknown>;
};

export type PlanChange = { testId: string; subject: string; template: TemplateId; change: "switched_off" | "switched_on" | "changed"; detail?: string };

export type RunContext = { profile: DatasetProfile; settings: RunSettings; testId: string };

export interface TestTemplate<P = Record<string, unknown>> {
  id: TemplateId;
  title: string;
  dimension: Dimension;
  /** What the test checks, in one sentence. */
  summary: string;
  /** Which columns it can apply to, shown when it is not applicable. */
  appliesTo: string;
  detailView: "pattern" | "records" | "distribution";
  autoInstances(profile: DatasetProfile, settings: RunSettings): TestDefinition<P>[];
  /** Plain-language sentence; the profile lets wording follow the column type ("before" for dates). */
  describe(definition: TestDefinition<P>, profile?: DatasetProfile): string;
  run(data: Dataset, params: P, ctx: RunContext): ResultCard;
  /** Columns deliberately left out, with the reason (shown on the result screen). */
  notApplied?(profile: DatasetProfile): SkipNote[];
}
