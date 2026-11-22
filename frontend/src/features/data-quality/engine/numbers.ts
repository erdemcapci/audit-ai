/*
 * Amounts as they appear in real exports: 1,234.56 and 1.234,56, currency signs, spaces or
 * apostrophes as thousands separators, accounting brackets (500.00) and SAP's trailing minus 500.00-.
 * The decimal mark is decided once per column, so "1.234,56" is never read as 1.23456.
 */

export type DecimalMark = "." | ",";

const CURRENCY = /[$€£¥₺₹]|\b(?:EUR|USD|GBP|TRY|CHF|JPY)\b/gi;

/** A finite number, or null when the value is not a number in this decimal convention. */
export function parseAmount(raw: string, decimal: DecimalMark = "."): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (s.endsWith("-") && !s.startsWith("-")) { negative = true; s = s.slice(0, -1).trim(); }
  s = s.replace(CURRENCY, "").replace(/%$/, "").replace(/[\s  ']/g, "");
  if (decimal === ",") {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Decimal mark of a column, by vote of the values that are unambiguous: "12,50" or "1.234,56" vote
 * for a comma, "12.50" or "1,234.56" for a dot. "1,234" and whole numbers do not vote. Ties: dot.
 */
export function detectDecimalMark(values: string[]): DecimalMark {
  let comma = 0, dot = 0;
  for (const raw of values) {
    const v = raw.trim().replace(/-$/, "");
    if (/\.\d{3},\d+$/.test(v) || /,(\d{1,2}|\d{4,})$/.test(v)) comma++;
    else if (/,\d{3}\.\d+$/.test(v) || /\.(\d{1,2}|\d{4,})$/.test(v)) dot++;
  }
  return comma > dot ? "," : ".";
}
