/** gzip helpers for storing source files; the browser's streams do the work. */

export async function gzip(bytes: ArrayBuffer): Promise<Blob> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

export async function gunzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV of exception records, for any result card. */
export function recordsCsv(rows: { row: number; value: string; reason: string }[], subject: string): Blob {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["row", subject, "reason"].map(esc).join(","), ...rows.map((r) => [r.row, r.value, r.reason].map(esc).join(","))];
  return new Blob([lines.join("\n")], { type: "text/csv" });
}
