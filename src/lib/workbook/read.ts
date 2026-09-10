import ExcelJS from "exceljs";

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

/** Streams an .xlsx from disk; only values are kept, so even big formatted reports fit in a small memory budget. */
export async function readWorkbookValues(filePath: string): Promise<SheetValues[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, { worksheets: "emit", sharedStrings: "cache", styles: "cache", hyperlinks: "ignore", entries: "ignore" });
  const sheets: SheetValues[] = [];
  for await (const ws of reader) {
    const sheet: SheetValues = { name: (ws as unknown as { name?: string }).name ?? `Sheet${sheets.length + 1}`, rows: new Map(), rowCount: 0, truncated: false };
    for await (const row of ws) {
      if (sheet.rows.size >= MAX_ROWS_PER_SHEET) {
        sheet.truncated = true;
        break;
      }
      const values = row.values as unknown[];
      if (!Array.isArray(values) || !values.some((v) => v !== null && v !== undefined && v !== "")) continue;
      sheet.rows.set(row.number, values);
      sheet.rowCount = row.number;
    }
    sheets.push(sheet);
  }
  return sheets;
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
