import type { ColumnInfo, DatasetProfile, ExceptionRecord, ResultCard, Severity, TechnicalType, TemplateId, TestDefinition } from "../types";

/**
 * Exception rows kept in memory per result card (for the detail table and the CSV export). Wide files
 * can produce hundreds of cards, so the cap keeps the page within a browser tab's memory. Counts are
 * always complete; only the list is capped.
 */
export const MAX_RECORDS = 20000;
export const STORED_EXAMPLES = 20;

/** How much a finding in a column of this type matters: amounts and keys more than descriptions. */
const TYPE_WEIGHT: Record<TechnicalType, number> = { identifier: 1.5, measure: 1.5, date: 1.25, category: 1, boolean: 1, free_text: 0.5, constant: 0.5, empty: 0.5 };

/**
 * Deterministic severity: share of affected records (banded) x how serious the test is x how
 * important the column type is. Scores >= 6 are high, >= 3 medium, anything else low.
 */
export function severityOf(exceptions: number, ratePercent: number, templateWeight: number, type?: TechnicalType): Severity {
  if (!exceptions) return "clean";
  const band = ratePercent < 1 ? 1 : ratePercent < 5 ? 2 : ratePercent < 20 ? 3 : 4;
  const score = band * templateWeight * (type ? TYPE_WEIGHT[type] : 1);
  return score >= 6 ? "high" : score >= 3 ? "medium" : "low";
}

export const count = (n: number) => n.toLocaleString("en-US");
export const percent = (value: number) => `${value.toFixed(value > 0 && value < 0.1 ? 2 : 1)}%`;
export const quote = (value: string) => `“${value}”`;

export function column(profile: DatasetProfile, name: string): ColumnInfo {
  const info = profile.columns.find((c) => c.name === name);
  if (!info) throw new Error(`Column not found: ${name}`);
  return info;
}

export function definition<P>(template: TemplateId, subject: string, params: P, reason: string, enabled = true): TestDefinition<P> {
  return { id: `${template}:${subject}`, template, subject, params, source: "standard", reason, enabled };
}

/** Collects exception records up to the in-memory cap. */
export class Collector {
  records: ExceptionRecord[] = [];
  total = 0;
  add(row: number, value: string, reason: string) {
    this.total++;
    if (this.records.length < MAX_RECORDS) this.records.push({ row, value, reason });
  }
  /** Counts an exception without listing it (when a list would say nothing, e.g. an empty column). */
  count() {
    this.total++;
  }
}

export function card(input: {
  testId: string;
  subject: string;
  tested: number;
  collector: Collector;
  severity: Severity;
  summary: string;
  facts?: Record<string, string | number>;
  detail?: unknown;
}): ResultCard {
  const { collector } = input;
  return {
    testId: input.testId,
    subject: input.subject,
    tested: input.tested,
    exceptions: collector.total,
    rate: input.tested ? (collector.total / input.tested) * 100 : 0,
    severity: input.severity,
    summary: input.summary,
    examples: collector.records.slice(0, STORED_EXAMPLES),
    facts: input.facts,
    records: collector.records,
    recordsCapped: collector.total > collector.records.length,
    detail: input.detail
  };
}

/** Row number as the auditor sees it in a spreadsheet: header is row 1. */
export const fileRow = (index: number) => index + 2;
