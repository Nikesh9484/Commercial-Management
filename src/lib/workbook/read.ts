import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import readline from "node:readline";

/** One worksheet reduced to its cell values only (no formatting), read row by row to keep memory low. */
export interface SheetValues {
  name: string;
  /** row number -> 1-based array of cell values (index 0 unused) */
  rows: Map<number, unknown[]>;
  /** last row number that has a value */
  rowCount: number;
  /** true when the sheet had more rows than we keep */
  truncated: boolean;
  /** row number -> 1-based column numbers whose cell is struck through (only rows that have any) */
  strikes?: Map<number, number[]>;
  /** row number -> the fill colours (ARGB, "FF9AE6DD") of its first twelve cells (only rows that have any) */
  fills?: Map<number, string[]>;
}

export const MAX_ROWS_PER_SHEET = 20000;

/**
 * Reads an .xlsx in a separate Node process (scripts/read-workbook.cjs) that streams the file
 * row by row and keeps only cell values. A workbook that is too big for the memory limit then
 * fails with a clear message instead of crashing the web server.
 */
export interface ReadOptions {
  /** only sheets whose name matches one of these are read (a big tracker's pivot and ranking sheets stay out) */
  sheets?: RegExp[];
  /** cells past this column are dropped */
  maxCols?: number;
  /** only the first N non-empty rows of every sheet: a quick look at what the workbook is */
  preview?: number;
  /** keep the slimmed copy of the workbook for a second pass (the caller of the last pass drops it) */
  keepSlim?: boolean;
}

/** The first rows of every sheet – enough to tell what the workbook is before it is read in full. */
export function readWorkbookPreview(filePath: string, rows = 20): Promise<SheetValues[]> {
  return readWorkbookValues(filePath, { preview: rows, keepSlim: true });
}

export async function readWorkbookValues(filePath: string, opts: ReadOptions = {}): Promise<SheetValues[]> {
  const script = path.join(process.cwd(), "scripts", "read-workbook.cjs");
  const outFile = `${filePath}.values.ndjson`;
  const heapMb = Number(process.env.WORKBOOK_READER_HEAP_MB || 112);
  const readerOpts = JSON.stringify({ sheets: (opts.sheets ?? []).map((r) => r.source), maxCols: opts.maxCols ?? 0, preview: opts.preview ?? 0 });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve, reject) => {
    const child = execFile(process.execPath, [`--max-old-space-size=${heapMb}`, "--max-semi-space-size=8", "--expose-gc", script, filePath, outFile], { timeout: 120_000, maxBuffer: 1 << 20, env: { ...process.env, WORKBOOK_READER_OPTS: readerOpts } }, (error, _stdout, stderr) => {
      const err = error as (Error & { code?: number | string; signal?: NodeJS.Signals; killed?: boolean }) | null;
      if (err && typeof err.code !== "number" && !err.signal && !err.killed) return reject(err); // could not start node at all
      resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, signal: err?.signal ?? null, stderr: String(stderr ?? "") });
    });
    // Low CPU priority so the web server keeps answering (and passes the host's health checks) while a big file is read.
    try {
      if (child.pid) os.setPriority(child.pid, 15);
    } catch {
      /* not supported on this platform */
    }
  });
  try {
    if (result.code !== 0) {
      const oom = result.signal === "SIGABRT" || /heap|memory/i.test(result.stderr);
      if (oom) throw new Error("This workbook is too large to read within the hosting plan's memory. Save a copy that contains only the schedule sheets (remove cover pages, pictures and unused sheets), then try again.");
      if (result.signal === "SIGTERM") throw new Error("Reading the workbook took too long (over 2 minutes). Save a copy with only the schedule sheets and try again.");
      const msg = result.stderr.trim().split("\n").filter(Boolean).pop() || `exit code ${result.code}`;
      throw new Error(`The workbook could not be read: ${msg}`);
    }
    // one JSON value per line, built straight into the sheets: the file is never held whole as one string
    const sheets: SheetValues[] = [];
    let cur: SheetValues | null = null;
    const rl = readline.createInterface({ input: fs.createReadStream(outFile, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const v = JSON.parse(line) as { sheet?: string; end?: boolean; rowCount?: number; truncated?: boolean } | [number, unknown[], number[]?, string[]?];
      if (Array.isArray(v)) {
        if (!cur) continue;
        cur.rows.set(v[0], v[1]);
        if (v[2]?.length) (cur.strikes ??= new Map()).set(v[0], v[2]);
        if (v[3]?.length) (cur.fills ??= new Map()).set(v[0], v[3]);
      } else if (v.sheet !== undefined) {
        cur = { name: v.sheet, rows: new Map(), rowCount: 0, truncated: false, strikes: new Map() };
        sheets.push(cur);
      } else if (v.end && cur) {
        cur.rowCount = v.rowCount ?? 0;
        cur.truncated = !!v.truncated;
        cur = null;
      }
    }
    return sheets;
  } finally {
    fs.rmSync(outFile, { force: true });
    if (!opts.keepSlim) fs.rmSync(`${filePath}.slim.xlsx`, { force: true });
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
