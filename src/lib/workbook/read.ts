import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

/** One worksheet reduced to its cell values only (no formatting), read row by row to keep memory low. */
export interface SheetValues {
  name: string;
  /** row number -> 1-based array of cell values (index 0 unused) */
  rows: Map<number, unknown[]>;
  /** last row number that has a value */
  rowCount: number;
  /** true when the sheet had more rows than we keep */
  truncated: boolean;
}

export const MAX_ROWS_PER_SHEET = 20000;

/**
 * Reads an .xlsx in a separate Node process (scripts/read-workbook.cjs) that streams the file
 * row by row and keeps only cell values. A workbook that is too big for the memory limit then
 * fails with a clear message instead of crashing the web server.
 */
export async function readWorkbookValues(filePath: string): Promise<SheetValues[]> {
  const script = path.join(process.cwd(), "scripts", "read-workbook.cjs");
  const outFile = `${filePath}.values.json`;
  const heapMb = Number(process.env.WORKBOOK_READER_HEAP_MB || 200);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [`--max-old-space-size=${heapMb}`, script, filePath, outFile], { timeout: 120_000, maxBuffer: 1 << 20 }, (error, _stdout, stderr) => {
      const err = error as (Error & { code?: number | string; signal?: NodeJS.Signals; killed?: boolean }) | null;
      if (err && typeof err.code !== "number" && !err.signal && !err.killed) return reject(err); // could not start node at all
      resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, signal: err?.signal ?? null, stderr: String(stderr ?? "") });
    });
  });
  try {
    if (result.code !== 0) {
      const oom = result.signal === "SIGABRT" || /heap|memory/i.test(result.stderr);
      if (oom) throw new Error("This workbook is too large to read within the hosting plan's memory. Save a copy that contains only the schedule sheets (remove cover pages, pictures and unused sheets), then try again.");
      if (result.signal === "SIGTERM") throw new Error("Reading the workbook took too long (over 2 minutes). Save a copy with only the schedule sheets and try again.");
      const msg = result.stderr.trim().split("\n").filter(Boolean).pop() || `exit code ${result.code}`;
      throw new Error(`The workbook could not be read: ${msg}`);
    }
    const raw = JSON.parse(fs.readFileSync(outFile, "utf8")) as { name: string; rowCount: number; truncated: boolean; rows: [number, unknown[]][] }[];
    return raw.map((s) => ({ name: s.name, rowCount: s.rowCount, truncated: s.truncated, rows: new Map(s.rows) }));
  } finally {
    fs.rmSync(outFile, { force: true });
  }
}

export function getSheet(sheets: SheetValues[], name: string): SheetValues | undefined {
  return sheets.find((s) => s.name === name);
}

/** Cell value at (row, col), both 1-based; undefined when empty. */
export function cellAt(sheet: SheetValues, row: number, col: number): unknown {
  return sheet.rows.get(row)?.[col];
}

/** Plain text for a cell value: dates as YYYY-MM-DD, formulas by their result, rich text joined. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("result" in o) return o.result === undefined || o.result === null ? "" : o.result instanceof Date ? o.result.toISOString().slice(0, 10) : String(o.result);
    if ("text" in o) return String(o.text);
    if ("error" in o) return "";
    return "";
  }
  return String(v);
}
