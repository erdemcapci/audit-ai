import type { Dataset } from "./csv";
import type { ColumnProfile, Priority } from "./patterns";

/*
 * Shared contracts of the data quality engine. A template is pre-written test code; a test definition
 * is a template plus parameters. Standard tests and (later) AI or auditor rules are the same thing and
 * differ only in `source`. Everything here is deterministic: the same plan on the same data gives the
 * same results, which is why a saved run can be re-executed from its stored source file.
 */

export type Severity = Priority;

export type TechnicalType = "identifier" | "category" | "measure" | "date" | "boolean" | "free_text" | "constant" | "empty";

export type Dimension = "completeness" | "validity" | "uniqueness" | "accuracy";

export type DateFormat = "yyyy-MM-dd" | "yyyy/MM/dd" | "dd.MM.yyyy" | "dd/MM/yyyy" | "MM/dd/yyyy" | "dd-MM-yyyy";

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

export type DatasetProfile = {
  rows: number;
  columns: ColumnInfo[];
  /** Stage-1 profiles of the character-pattern engine, one per column. */
  patterns: ColumnProfile[];
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
};

export const DEFAULT_SETTINGS: RunSettings = {
  blankThresholdPercent: 1,
  patternThresholdPercent: 3,
  keepSpecial: false,
  outlierFactor: 3,
  dateFormats: {}
};

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
  | "accuracy.calendar";

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
};

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

export type RunTotals = { tests: number; findings: number; high: number; medium: number; low: number; exceptions: number };

export type Verdict = "no_issues" | "issues_to_review" | "significant_issues";

export type RunResults = { tests: TestNodeResult[]; totals: RunTotals; verdict: Verdict };

export type RunStep = {
  id: string;
  kind: "file" | "code" | "auditor";
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
  detailView: "pattern" | "records";
  autoInstances(profile: DatasetProfile, settings: RunSettings): TestDefinition<P>[];
  describe(definition: TestDefinition<P>): string;
  run(data: Dataset, params: P, ctx: RunContext): ResultCard;
  /** Columns deliberately left out, with the reason (shown on the result screen). */
  notApplied?(profile: DatasetProfile): SkipNote[];
}
