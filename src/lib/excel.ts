import { APP_NAME } from "./brand";
import ExcelJS from "exceljs";
import type { FieldDef, RegisterDef, RecordRow, UserInfo } from "./registers/types";
import { listRecords, lookupOptions, createRecord, updateRecord, getRecord, ValidationError } from "./registers/engine";
import { getDb } from "./db";
import { formatDate, toDate, todayIso } from "./format";
import { XL, titleBlock, headerRow, totalRow, sumFormula, finishWorkbook, setWorkbookLink, applyColumnFormat, solid } from "./xlsx-style";

const HEADER_FILL: ExcelJS.Fill = solid(XL.navy);

function exportFields(def: RegisterDef): FieldDef[] {
  return def.fields.filter((f) => f.type !== "password");
}

/**
 * Builds an .xlsx workbook with all rows of a register: title band, coloured header, zebra rows,
 * dates as real dates, money with 2 decimals, SUM totals, status colouring, filter and frozen header.
 * The file re-imports as it is (the header row is found automatically).
 */
export async function exportRegister(def: RegisterDef, link?: { url: string; label: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  setWorkbookLink(wb, link);
  const ws = wb.addWorksheet(def.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const fields = exportFields(def);
  const rows = listRecords(def);
  const cols = [{ header: "ID", key: "id", width: 8, type: "number" }, ...fields.map((f) => ({ header: f.label, key: f.key, width: f.type === "textarea" ? 40 : Math.max(14, Math.min(34, f.label.length + 4)), type: f.type })), { header: "Last updated", key: "updated_at", width: 14, type: "date" }, { header: "Updated by", key: "updated_by", width: 18, type: "text" }];
  titleBlock(ws, def.title, `${rows.length} row(s) · exported ${formatDate(todayIso())} · ${APP_NAME}`, Math.min(cols.length, 10));
  headerRow(ws.addRow(cols.map((c) => c.header)));
  const first = ws.rowCount + 1;
  for (const r of rows) {
    ws.addRow([r.id, ...fields.map((f) => cellValue(f, r)), toDate(String(r.updated_at ?? "")) ?? "", r.updated_by]);
  }
  const last = ws.rowCount;
  if (def.totals?.length && last >= first) {
    const t = ws.addRow([`Total (${rows.length})`]);
    cols.forEach((c, i) => {
      if (def.totals!.includes(c.key)) t.getCell(i + 1).value = sumFormula(i + 1, first, last, rows.reduce((s, r) => s + (Number(r[c.key] ?? 0) || 0), 0));
    });
    totalRow(t);
  }
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    applyColumnFormat(col, c.type);
  });
  await addListsSheet(wb, def);
  finishWorkbook(wb, { freeze: { [ws.name]: 2 } });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Empty workbook with the right headers + a Lists sheet showing allowed values. */
export async function exportTemplate(def: RegisterDef): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  const fields = exportFields(def).filter((f) => !f.virtual && (!f.readonly || f.type === "select"));
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
  ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
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

  const fields = exportFields(def);
  const colMap = new Map<number, FieldDef | "id">();
  // The header row is the first row where at least two cells are column names (exports carry a title band above it).
  let headerRowNo = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    let hits = 0;
    ws.getRow(r).eachCell((cell) => {
      const h = String(cellText(cell.value)).trim().toLowerCase();
      if (h === "id" || fields.some((x) => x.label.toLowerCase() === h || x.key.toLowerCase() === h)) hits++;
    });
    if (hits >= 2) {
      headerRowNo = r;
      break;
    }
  }
  const headerRow = ws.getRow(headerRowNo);
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
    for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      if (/^total\b/i.test(String(cellText(row.getCell(1).value)))) continue;
      const input: Record<string, unknown> = {};
      let id: number | null = null;
      let any = false;
      for (const [colNumber, target] of colMap) {
        const raw = cellText(row.getCell(colNumber).value);
        if (target === "id") {
          if (raw !== "" && raw !== null) id = Number(raw);
          continue;
        }
        if (target.readonly || target.virtual) continue;
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
