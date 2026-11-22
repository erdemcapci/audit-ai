import type { TemplateId, TestTemplate } from "../types";
import { outliers, weekendDates } from "./accuracy";
import { blankValues, placeholderValues } from "./completeness";
import { characterPatterns } from "./pattern";
import { datasetRules } from "./rules";
import { duplicateRows, uniqueKey } from "./uniqueness";
import { allowedValues, typeConformance, valueRange } from "./validity";

/** Every template, in the order tests run and appear on the run map. Explicit on purpose: no auto-discovery. */
export const TEMPLATES: TestTemplate<any>[] = [
  blankValues,
  placeholderValues,
  typeConformance,
  characterPatterns,
  allowedValues,
  valueRange,
  uniqueKey,
  duplicateRows,
  outliers,
  weekendDates,
  datasetRules
];

export function getTemplate(id: TemplateId): TestTemplate<any> {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Unknown test template: ${id}`);
  return template;
}
