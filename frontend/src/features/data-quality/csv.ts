export type Dataset = { name: string; headers: string[]; rows: string[][] };

const MISSING = new Set(["", "null", "n/a", "na", "none", "nan", "-"]);

export function isMissing(value: string | undefined) {
  return MISSING.has((value ?? "").trim().toLowerCase());
}

/** RFC 4180-style parser: quoted fields, escaped quotes, CRLF, embedded newlines. Delimiter is sniffed. */
export function parseCsv(text: string, name = "dataset"): Dataset {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field); field = "";
      records.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); records.push(row); }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return { name, headers: [], rows: [] };
  const headers = nonEmpty[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = nonEmpty.slice(1).map((r) => headers.map((_, i) => r[i] ?? ""));
  return { name, headers, rows };
}

export function parseNumber(value: string): number | null {
  const cleaned = value.trim().replace(/[,\s$€£]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  return Number(cleaned);
}

