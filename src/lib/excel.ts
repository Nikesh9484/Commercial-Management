import ExcelJS from "exceljs";
import type { FieldDef, RegisterDef, RecordRow, UserInfo } from "./registers/types";
import { listRecords, lookupOptions, createRecord, updateRecord, getRecord, ValidationError } from "./registers/engine";
import { getDb } from "./db";
import { formatDate, toDate } from "./format";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2B4C" } };

function exportFields(def: RegisterDef): FieldDef[] {
  return def.fields.filter((f) => f.type !== "password");
}

/** Builds an .xlsx workbook with all rows of a register (dates as DD-MMM-YY, money with 2 decimals). */
export async function exportRegister(def: RegisterDef): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Commercial Dashboard";
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  const fields = exportFields(def);
  ws.columns = [
    { header: "ID", key: "id", width: 8 },
    ...fields.map((f) => ({ header: f.label, key: f.key, width: f.type === "textarea" ? 40 : Math.max(14, f.label.length + 4) })),
    { header: "Last updated", key: "updated_at", width: 18 },
    { header: "Updated by", key: "updated_by", width: 18 },
  ];
  const rows = listRecords(def);
  for (const r of rows) {
    const out: Record<string, unknown> = { id: r.id, updated_at: formatDate(r.updated_at as string), updated_by: r.updated_by };
    for (const f of fields) out[f.key] = cellValue(f, r);
    ws.addRow(out);
  }
  styleSheet(ws, fields);
  await addListsSheet(wb, def);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Empty workbook with the right headers + a Lists sheet showing allowed values. */
export async function exportTemplate(def: RegisterDef): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  const fields = exportFields(def).filter((f) => !f.readonly || f.type === "select");
  ws.columns = [{ header: "ID", key: "id", width: 8 }, ...fields.map((f) => ({ header: f.label, key: f.key, width: Math.max(14, f.label.length + 4) }))];
  styleSheet(ws, fields);
  ws.addRow({});
  await addListsSheet(wb, def);
  const notes = wb.addWorksheet("How to use");
  notes.getColumn(1).width = 110;
  [
    `Import template for "${def.title}".`,
    "• Fill one record per row under the headers. Leave the ID column blank for new records.",
    "• To update an existing record, put its ID (from an export) in the ID column.",
    "• Dates: use DD-MMM-YY (e.g. 09-Sep-26) or a real Excel date.",
    "• Money: plain numbers, no currency symbol (e.g. 1250000.50).",
    "• Yes/No columns: type Yes or No.",
    "• Dropdown / lookup columns: type the value exactly as shown on the Lists sheet.",
    `• Required columns: ${fields.filter((f) => f.required).map((f) => f.label).join(", ") || "none"}.`,
  ].forEach((t) => notes.addRow([t]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellValue(f: FieldDef, r: RecordRow): unknown {
  const v = r[f.key];
  if (v === null || v === undefined) return "";
  switch (f.type) {
    case "date":
      return toDate(String(v)) ?? "";
    case "boolean":
      return v ? "Yes" : "No";
    case "lookup":
      return r[`${f.key}__label`] ?? "";
    case "money":
    case "number":
    case "percent":
      return Number(v);
    default:
      return v;
  }
}

function styleSheet(ws: ExcelJS.Worksheet, fields: FieldDef[]) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length + 1 } };
  fields.forEach((f, i) => {
    const col = ws.getColumn(i + 2);
    if (f.type === "money") col.numFmt = "#,##0.00";
    if (f.type === "number") col.numFmt = "0.##";
    if (f.type === "percent") col.numFmt = "0.00";
    if (f.type === "date") col.numFmt = "DD-MMM-YY";
  });
}

async function addListsSheet(wb: ExcelJS.Workbook, def: RegisterDef) {
  const listFields = def.fields.filter((f) => f.type === "select" || f.type === "lookup" || f.type === "boolean");
  if (!listFields.length) return;
  const ws = wb.addWorksheet("Lists");
  const db = getDb();
  listFields.forEach((f, i) => {
    const col = ws.getColumn(i + 1);
    col.width = 28;
    const values = f.type === "select" ? (f.options ?? []) : f.type === "boolean" ? ["Yes", "No"] : lookupOptions(db, f.lookup!.register).map((o) => o.label);
    ws.getCell(1, i + 1).value = f.label;
    values.forEach((v, r) => (ws.getCell(r + 2, i + 1).value = v));
  });
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = HEADER_FILL;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export async function importRegister(def: RegisterDef, file: ArrayBuffer, user: UserInfo): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file);
  const ws = wb.worksheets.find((w) => w.name !== "Lists" && w.name !== "How to use") ?? wb.worksheets[0];
  if (!ws) throw new ValidationError("The file has no worksheet.");

  const headerRow = ws.getRow(1);
  const fields = exportFields(def);
  const colMap = new Map<number, FieldDef | "id">();
  headerRow.eachCell((cell, colNumber) => {
    const h = String(cellText(cell.value)).trim().toLowerCase();
    if (!h) return;
    if (h === "id") return void colMap.set(colNumber, "id");
    const f = fields.find((x) => x.label.toLowerCase() === h || x.key.toLowerCase() === h);
    if (f) colMap.set(colNumber, f);
  });
  if (![...colMap.values()].some((v) => v !== "id")) {
    throw new ValidationError("No matching columns found. Row 1 must contain the column names from the template / export.");
  }

  const result: ImportResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };
  const db = getDb();
  const tx = db.transaction(() => {
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      const input: Record<string, unknown> = {};
      let id: number | null = null;
      let any = false;
      for (const [colNumber, target] of colMap) {
        const raw = cellText(row.getCell(colNumber).value);
        if (target === "id") {
          if (raw !== "" && raw !== null) id = Number(raw);
          continue;
        }
        if (target.readonly) continue;
        if (raw !== "" && raw !== null && raw !== undefined) any = true;
        input[target.key] = raw;
      }
      if (!any) {
        result.skipped++;
        continue;
      }
      try {
        const before = id ? getRecord(def, id) : null;
        if (id && before) {
          const after = updateRecord(def, id, input, user, "import");
          if (after.updated_at === before.updated_at) result.unchanged++;
          else result.updated++;
        } else {
          createRecord(def, input, user, "import");
          result.created++;
        }
      } catch (e) {
        const msg = e instanceof ValidationError ? [e.message, ...Object.values(e.fieldErrors)].join(" ") : e instanceof Error ? e.message : String(e);
        result.errors.push({ row: r, message: msg });
      }
    }
  });
  tx();
  return result;
}

function cellText(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result ?? "";
    if ("text" in v) return v.text;
    if ("error" in v) return "";
    return String(v);
  }
  return v;
}
