import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { APP_NAME } from "../brand";
import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { listRecords, lookupOptions } from "../registers/engine";
import { listPeriods, latestPeriod } from "../snapshots";
import { snapshotRows } from "../view-mode";
import { getCashflow } from "../cashflow/compute";
import { computeCostReport, type CostLineRow } from "../cost-report/compute";
import { level1Matrix } from "../cost-report/level1";
import type { RecordRow } from "../registers/types";
import { XL, titleBlock, sectionRow, solid, colLetter } from "../xlsx-style";
import { addChartsToXlsx, type XlsxChart } from "../xlsx-charts";
import { buildVbaProject, type VbaModule } from "./ovba";
import { EAR_SCHEMA } from "../ear/model";
import { SYSTEM as EAR_SYSTEM, REVISION_RULES as EAR_REVISION_RULES, EAR_MODEL } from "../ear/generate";
import { REGISTER_TABLES, LISTS, FORMULAS, LEVEL2, CHANGES, CLAIMS, EW, RISKS, PS, BONDS, CONTRACTS, IPC, FA, TRANSFERS, CASHFLOW, ACTIONS, PERIODS, SNAPSHOTS, USERS, ACTIVITY, type TableSpec, type Col } from "./schema";

/**
 * The dashboard as a self-contained Excel application (.xlsm): sign in with the same users and
 * roles, every module as a table with the dashboard's rules as formulas, Level 1 / Level 2 /
 * Movement, the monthly-report and stand-alone imports, period lock and stored copies, PDF export
 * – all inside Excel, with the current data of the website loaded.
 */
const SALT = "marina-cd-2026:";
const MONEY = "#,##0.00;[Red](#,##0.00)";
const WHOLE = "#,##0;[Red](#,##0)";
const DATE = "DD-MMM-YY";
const CATEGORIES = LISTS.Category;
const SHEETS_ORDER = ["Login", "Home", "Setup", "Periods", "Level 1", "Level 2", "Movement", "Changes", "Claims", "Early Warnings", "Risks", "Provisional Sums", "Bonds", "Contracts", "IPCs", "Final Accounts", "Cash Flow", "Transfers", "Actions", "Snapshots", "Users", "Activity", "Lists"];
const TILE = { navy: "FF1F3A5F", teal: "FF0E7C86", orange: "FFEB6834", green: "FF2E9E5B", red: "FFD64545", blue: "FF2A78D6", purple: "FF7C5CBF", gold: "FFC9A227" };
const CHART_COLORS = { navy: "1F3A5F", teal: "0E7C86", orange: "EB6834", green: "2E9E5B", red: "D64545", blue: "2A78D6", purple: "7C5CBF", gold: "C9A227", amber: "E29A1A", grey: "6B7280" };

/* ------------------------------------------------------------------ hashing (mirrors modAuth) */

export function hashPassword(pwd: string): string {
  const sha = "sha256:" + crypto.createHash("sha256").update(SALT + pwd, "utf8").digest("hex");
  return `${sha}|${simpleHash(SALT + pwd)}`;
}
function simpleHash(s: string): string {
  let out = "";
  for (let seed = 1; seed <= 4; seed++) {
    let h = 2166136261 + seed * 7919;
    for (let i = 0; i < s.length; i++) {
      h = h * 16777619 + s.charCodeAt(i);
      h = h - Math.floor(h / 4294967296) * 4294967296;
    }
    const v = h - Math.floor(h / 2147483648) * 2147483648;
    out += Math.trunc(v).toString(16).padStart(8, "0");
  }
  return "simple:" + out.toLowerCase();
}

/* ------------------------------------------------------------------ structured references in the file format */

/** Converts the UI form of a structured-reference formula ([@Col], [Col]) to the form stored in the file. */
function fileFormula(formula: string, table: string): string {
  let f = formula.replace(/^=/, "");
  // a bare [Column] of the table itself (preceded by "(" or "," – never by a table name, "[" or "@")
  f = f.replace(/(^|[^A-Za-z0-9_\]\[@])\[([A-Za-z0-9_.%()\- ]+)\]/g, (m, pre, c) => (c === "#This Row" ? m : `${pre}${table}[${c}]`));
  f = f.replace(/\[@\[([^\]]+)\]\]/g, (_, c) => `${table}[[#This Row],[${c}]]`);
  f = f.replace(/\[@([A-Za-z0-9_.%()\- ]+?)\]/g, (_, c) => `${table}[[#This Row],[${c}]]`);
  return f;
}

/* ------------------------------------------------------------------ data */

interface Seed {
  programme: { id: number; code: string; name: string };
  asset: { code: string; name: string };
  client: string;
  location: string;
  periods: RecordRow[];
  currentReportNo: number;
  rows: Record<string, RecordRow[]>;
  lines: CostLineRow[];
  snapshots: { reportNo: number; lines: CostLineRow[] }[];
  cashflow: { month: Date; forecast: number }[];
  users: { name: string; email: string; role: string; active: boolean }[];
  lineCode: Map<number, string>;
  contractPo: Map<number, string>;
  meetingNo: Map<number, string>;
  changeItem: Map<number, string>;
}

function loadSeed(programmeId: number): Seed {
  const db = getDb();
  const programme = db.prepare("SELECT id, code, name, client_id, location_id FROM programmes WHERE id = ?").get(programmeId) as { id: number; code: string; name: string; client_id: number | null; location_id: number | null };
  const assetId = db.prepare("SELECT value FROM app_settings WHERE key = 'current_asset_id'").get() as { value: string } | undefined;
  const asset = (assetId ? (db.prepare("SELECT code, name FROM assets WHERE id = ? AND programme_id = ?").get(Number(assetId.value), programmeId) as { code: string; name: string } | undefined) : undefined) ?? (db.prepare("SELECT code, name FROM assets WHERE programme_id = ? ORDER BY id LIMIT 1").get(programmeId) as { code: string; name: string } | undefined) ?? { code: "", name: "" };
  const client = lookupOptions(db, "clients", true).find((c) => c.id === programme.client_id)?.label ?? "";
  const location = lookupOptions(db, "locations", true).find((c) => c.id === programme.location_id)?.label ?? "";
  const periods = listPeriods().slice().sort((a, b) => a.report_no - b.report_no) as unknown as RecordRow[];
  const latest = latestPeriod(db);
  const rows: Record<string, RecordRow[]> = {};
  for (const key of ["cost_lines", "changes", "claims", "early_warnings", "risks", "provisional_sums", "bonds", "contracts", "payment_applications", "final_accounts", "budget_transfers", "actions", "meetings"]) {
    const def = getRegisterDef(key);
    rows[key] = def ? listRecords(def) : [];
  }
  const lineCode = new Map<number, string>();
  for (const r of db.prepare("SELECT id, code FROM cost_lines").all() as { id: number; code: string }[]) lineCode.set(r.id, r.code);
  const contractPo = new Map<number, string>();
  for (const r of rows.contracts) contractPo.set(Number(r.id), String(r.reef_po_no ?? ""));
  const meetingNo = new Map<number, string>();
  for (const r of rows.meetings) meetingNo.set(Number(r.id), String(r.meeting_no ?? ""));
  const changeItem = new Map<number, string>();
  for (const r of rows.changes) changeItem.set(Number(r.id), String(r.item_no ?? ""));
  const lines = latest ? computeCostReport(programmeId, latest.id).lines : [];
  const snapshots: Seed["snapshots"] = [];
  for (const p of periods) {
    const snap = snapshotRows<CostLineRow>(db, Number(p.id), "cost_report");
    if (snap && snap.length) snapshots.push({ reportNo: Number(p.report_no), lines: snap });
  }
  const cf = getCashflow(db, programmeId);
  const cashflow = cf.months.map((m) => ({ month: new Date(`${m.key}-01T00:00:00Z`), forecast: cf.monthTotals[m.key]?.forecast ?? 0 }));
  const users = (db.prepare("SELECT name, email, role, active FROM users ORDER BY id").all() as { name: string; email: string; role: string; active: number }[]).map((u) => ({ ...u, active: !!u.active }));
  return { programme, asset, client, location, periods, currentReportNo: latest ? latest.report_no : 1, rows, lines, snapshots, cashflow, users, lineCode, contractPo, meetingNo, changeItem };
}

/* ------------------------------------------------------------------ cell values from register rows */

function cellValue(c: Col, r: RecordRow, seed: Seed): ExcelJS.CellValue {
  if (!c.key) return null;
  const v = r[c.key];
  if (c.key === "cost_line_id" || c.key === "from_cost_line_id" || c.key === "to_cost_line_id") return v ? (seed.lineCode.get(Number(v)) ?? "") : "";
  if (c.key === "contract_id") return v ? (seed.contractPo.get(Number(v)) ?? String(r[`${c.key}__label`] ?? "")) : "";
  if (c.key === "meeting_id") return v ? (seed.meetingNo.get(Number(v)) ?? "") : "";
  if (c.key === "change_id") return v ? (seed.changeItem.get(Number(v)) ?? "") : "";
  if (c.key.endsWith("_id")) return String(r[`${c.key}__label`] ?? "");
  if (v === null || v === undefined || v === "") return null;
  if (c.type === "bool") return v === true || v === 1 || v === "1" || v === "true" ? "Yes" : "No";
  if (c.type === "date") {
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (c.type === "money" || c.type === "number" || c.type === "pct") return Number(v);
  return String(v);
}

/* ------------------------------------------------------------------ sheet builders */

const sheet = (wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet => wb.getWorksheet(name) ?? wb.addWorksheet(name);

interface Names {
  add: (name: string, sheet: string, cell: string) => void;
}

function tableSheet(wb: ExcelJS.Workbook, spec: TableSpec, data: ExcelJS.CellValue[][], opts: { subtitle: string; firstRow?: number; before?: (ws: ExcelJS.Worksheet) => void }): { ws: ExcelJS.Worksheet; first: number; last: number } {
  const ws = sheet(wb, spec.sheet);
  titleBlock(ws, spec.title, opts.subtitle, Math.min(spec.cols.length, 10));
  opts.before?.(ws);
  const headerRowNo = Math.max(opts.firstRow ?? ws.rowCount + 1, ws.rowCount + 1);
  while (ws.rowCount < headerRowNo - 1) ws.addRow([]);
  const rows = data.length ? data : [spec.cols.map(() => null)];
  ws.addTable({
    name: spec.table,
    ref: `A${headerRowNo}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: spec.cols.map((c) => ({ name: c.h, filterButton: true })),
    rows,
  });
  const first = headerRowNo + 1;
  const last = headerRowNo + rows.length;
  spec.cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? (c.type === "money" ? 16 : c.type === "date" ? 11 : c.type === "number" || c.type === "pct" ? 10 : 14);
    if (c.type === "money") col.numFmt = MONEY;
    if (c.type === "date") col.numFmt = DATE;
    if (c.type === "pct") col.numFmt = "0.0%";
    if (c.formula) {
      const f = fileFormula(c.formula, spec.table);
      for (let r = first; r <= last; r++) ws.getCell(r, i + 1).value = { formula: f, result: undefined };
    }
    if (c.list && LISTS[c.list]) {
      const n = LISTS[c.list].length;
      const listCol = colLetter(Object.keys(LISTS).indexOf(c.list) + 1);
      (ws as unknown as { dataValidations: { add: (range: string, v: object) => void } }).dataValidations.add(`${colLetter(i + 1)}${first}:${colLetter(i + 1)}${last + 500}`, { type: "list", allowBlank: true, formulae: [`=Lists!$${listCol}$2:$${listCol}$${n + 1}`], showErrorMessage: false });
    }
  });
  ws.getRow(headerRowNo).font = { bold: true, color: { argb: XL.white } };
  ws.getRow(headerRowNo).alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(headerRowNo).height = 30;
  ws.views = [{ state: "frozen", ySplit: headerRowNo, xSplit: 1 }];
  return { ws, first, last };
}

/** A coloured tile: label, big value (a formula), small note. */
function tile(ws: ExcelJS.Worksheet, row: number, col: number, span: number, label: string, formula: string, fill: string, fmt = WHOLE, sub = "") {
  const end = col + span - 1;
  for (let r = row; r <= row + 2; r++) for (let c = col; c <= end; c++) ws.getCell(r, c).fill = solid(fill);
  const l = ws.getCell(row, col);
  l.value = label.toUpperCase();
  l.font = { bold: true, size: 8, color: { argb: "FFE4ECF6" } };
  l.alignment = { vertical: "bottom", indent: 1 };
  const v = ws.getCell(row + 1, col);
  v.value = { formula, result: undefined };
  v.numFmt = fmt;
  v.font = { bold: true, size: 16, color: { argb: XL.white } };
  v.alignment = { vertical: "middle", indent: 1 };
  const s = ws.getCell(row + 2, col);
  s.value = sub;
  s.font = { size: 8, color: { argb: "FFE4ECF6" } };
  s.alignment = { vertical: "top", indent: 1 };
  ws.mergeCells(row, col, row, end);
  ws.mergeCells(row + 1, col, row + 1, end);
  ws.mergeCells(row + 2, col, row + 2, end);
  ws.getRow(row + 1).height = 30;
}

function loginSheet(wb: ExcelJS.Workbook, names: Names, seed: Seed) {
  const ws = sheet(wb, "Login");
  ws.views = [{ showGridLines: false }];
  [3, 34, 3, 60].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (let r = 1; r <= 40; r++) for (let c = 1; c <= 10; c++) ws.getCell(r, c).fill = solid("FF0F2B4C");
  ws.getCell("B3").value = APP_NAME.toUpperCase();
  ws.getCell("B3").font = { size: 11, color: { argb: "FF9FB3C8" }, bold: true };
  ws.getCell("B4").value = "Excel edition – sign in";
  ws.getCell("B4").font = { size: 22, bold: true, color: { argb: XL.white } };
  ws.getCell("B5").value = `${seed.programme.code} · ${seed.programme.name}${seed.asset.code ? ` · ${seed.asset.code} ${seed.asset.name}` : ""}`;
  ws.getCell("B5").font = { size: 10, color: { argb: "FFDCE6F2" } };
  const label = (cell: string, text: string) => {
    ws.getCell(cell).value = text;
    ws.getCell(cell).font = { bold: true, size: 9, color: { argb: "FFC7D3E2" } };
  };
  label("B7", "EMAIL");
  label("B10", "PASSWORD");
  for (const cell of ["B8", "B11"]) {
    ws.getCell(cell).fill = solid(XL.white);
    ws.getCell(cell).font = { size: 12, color: { argb: XL.ink } };
    ws.getCell(cell).alignment = { vertical: "middle", indent: 1 };
    ws.getCell(cell).protection = { locked: false };
  }
  ws.getRow(8).height = 24;
  ws.getRow(11).height = 24;
  ws.getCell("B11").numFmt = ";;;";
  ws.getCell("B13").value = "";
  ws.getCell("B13").font = { size: 10, bold: true, color: { argb: "FFFFB4B4" } };
  ws.getCell("B15").value = "";
  ws.getCell("D8").value = "Type your email, then your password in the white box below (it shows as blank while you type), and click Sign in.";
  ws.getCell("D8").font = { size: 10, color: { argb: "FFDCE6F2" } };
  ws.getCell("D8").alignment = { wrapText: true, vertical: "top" };
  ws.getCell("D11").value = "If the Sign in button is missing, macros are switched off: close the file, right-click it → Properties → tick Unblock, open it again and choose Enable Content.";
  ws.getCell("D11").font = { size: 10, color: { argb: "FFDCE6F2" } };
  ws.getCell("D11").alignment = { wrapText: true, vertical: "top" };
  ws.getCell("B20").value = "First sign-in passwords: the administrator uses Admin@123, everyone else Welcome@123. You are asked to choose your own password the first time.";
  ws.getCell("B20").font = { size: 9, italic: true, color: { argb: "FF9FB3C8" } };
  ws.mergeCells("B20:D21");
  ws.getCell("B20").alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells("D8:D9");
  ws.mergeCells("D11:D13");
  names.add("LoginEmail", "Login", "$B$8");
  names.add("LoginPassword", "Login", "$B$11");
  names.add("LoginMessage", "Login", "$B$13");
  names.add("LoginButton", "Login", "$B$15");
  ws.protect("marina-dashboard", { selectLockedCells: true, selectUnlockedCells: true });
}

function setupSheet(wb: ExcelJS.Workbook, names: Names, seed: Seed) {
  const ws = sheet(wb, "Setup");
  [30, 40, 4, 30, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  titleBlock(ws, "Project setup & report control", "Programme, asset, current report and the rules used by the formulas", 5);
  const put = (row: number, label: string, value: ExcelJS.CellValue, name: string, fmt?: string) => {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: true, color: { argb: XL.navy } };
    ws.getCell(row, 2).value = value;
    ws.getCell(row, 2).fill = solid(XL.zebra);
    if (fmt) ws.getCell(row, 2).numFmt = fmt;
    names.add(name, "Setup", `$B$${row}`);
  };
  sectionRow(ws, "Programme and asset", 5, XL.navyLight);
  put(5, "Programme code", seed.programme.code, "ProgrammeCode");
  put(6, "Programme name", seed.programme.name, "ProgrammeName");
  put(7, "Asset code", seed.asset.code, "AssetCode");
  put(8, "Asset name", seed.asset.name, "AssetName");
  put(9, "Client", seed.client, "ClientName");
  put(10, "Location", seed.location, "LocationName");
  ws.addRow([]);
  sectionRow(ws, "Current report", 5, XL.navyLight);
  put(13, "Current report No", seed.currentReportNo, "CurrentReportNo", "0");
  put(14, "Previous issued report No (stored copy)", { formula: `IFERROR(MAXIFS(tblSnapshots[Report No],tblSnapshots[Report No],"<"&CurrentReportNo),0)`, result: undefined }, "PrevReportNo", "0");
  put(15, "Current report label", { formula: `IFERROR(INDEX(tblPeriods[Label],MATCH(CurrentReportNo,tblPeriods[Report No],0)),"Report No "&CurrentReportNo)`, result: undefined }, "CurrentPeriodLabel");
  put(16, "Cut-off date", { formula: `IFERROR(INDEX(tblPeriods[Period end],MATCH(CurrentReportNo,tblPeriods[Report No],0)),"")`, result: undefined }, "CurrentPeriodEnd", DATE);
  put(17, "Status", { formula: `IFERROR(INDEX(tblPeriods[Status],MATCH(CurrentReportNo,tblPeriods[Report No],0)),"")`, result: undefined }, "CurrentPeriodStatus");
  ws.addRow([]);
  sectionRow(ws, "Rules", 5, XL.navyLight);
  put(20, "Bonds: amber when expiring within (days)", 60, "ExpiryAmberDays", "0");
  put(21, "Bonds: red when expiring within (days)", 30, "ExpiryRedDays", "0");
  put(22, "API key for the Claim EAR (Anthropic, admin only)", "", "ApiKey");
  put(23, "Claim EAR model", EAR_MODEL, "EarModel");
  ws.getCell(22, 2).numFmt = ";;;";
  ws.getCell(22, 4).value = "Type the key here; it shows as blank. The website's key works here too.";
  ws.getCell(22, 4).font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.addRow([]);
  sectionRow(ws, "Signed in (set by the workbook)", 5, XL.navyLight);
  put(24, "User", "", "SignedInUser");
  put(25, "Email", "", "SignedInEmail");
  put(26, "Role", "", "SignedInRole");
  const note = ws.getCell(28, 1);
  note.value = "Change the programme, asset, client and location here. The report number moves on with 'New month' or when a later monthly report is imported.";
  note.font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.mergeCells(28, 1, 28, 5);
}

function listsSheet(wb: ExcelJS.Workbook) {
  const ws = sheet(wb, "Lists");
  const keys = Object.keys(LISTS);
  keys.forEach((k, i) => {
    ws.getCell(1, i + 1).value = k;
    ws.getCell(1, i + 1).font = { bold: true, color: { argb: XL.white } };
    ws.getCell(1, i + 1).fill = solid(XL.navy);
    ws.getColumn(i + 1).width = Math.max(14, k.length + 2);
    LISTS[k].forEach((v, j) => (ws.getCell(j + 2, i + 1).value = v));
  });
  // the calculated-column formulas, for the VBA to re-apply after imports
  const rows: ExcelJS.CellValue[][] = [];
  for (const t of REGISTER_TABLES) for (const c of t.cols) if (c.formula) rows.push([t.table, c.h, c.formula]);
  const start = 30;
  ws.getCell(start - 1, 1).value = FORMULAS.title;
  ws.getCell(start - 1, 1).font = { bold: true, color: { argb: XL.navy } };
  ws.addTable({ name: FORMULAS.table, ref: `A${start}`, headerRow: true, totalsRow: false, style: { theme: "TableStyleLight9", showRowStripes: true }, columns: FORMULAS.cols.map((c) => ({ name: c.h, filterButton: false })), rows });
  ws.getColumn(3).width = 120;
  // the Claim EAR drafting instructions, identical to the website's
  ws.getCell(1, 30).value = "Claim EAR – system prompt";
  ws.getCell(2, 30).value = EAR_SYSTEM;
  ws.getCell(1, 31).value = "Claim EAR – revision rules";
  ws.getCell(2, 31).value = EAR_REVISION_RULES;
  ws.getCell(1, 32).value = "Claim EAR – required JSON shape";
  ws.getCell(2, 32).value = JSON.stringify(EAR_SCHEMA);
  for (const c of [30, 31, 32]) {
    ws.getCell(1, c).font = { bold: true, color: { argb: XL.white } };
    ws.getCell(1, c).fill = solid(XL.navy);
    ws.getCell(2, c).alignment = { wrapText: false, vertical: "top" };
    ws.getColumn(c).width = 40;
  }
  ws.getRow(2).height = 15;
}

/** Level 1 in the Excel "Level 01" layout, every figure a SUMIFS over the Level 2 table. */
function level1Sheet(wb: ExcelJS.Workbook, names: Names, seed: Seed): { rows: Record<string, number>; totalCol: number; headerRow: number; nCats: number } {
  const ws = sheet(wb, "Level 1");
  const cats = CATEGORIES;
  const TOTAL = 2 + cats.length;
  const PREV = TOTAL + 1;
  const MOVE = TOTAL + 2;
  titleBlock(ws, "Cost Report – Level 1 (Executive)", "Every figure is a formula over the Level 2 table; Previous = the stored copy of the previous issued report", MOVE);
  const hdr = ws.addRow(["SAR", ...cats, "Total", "Previous report", "Movement"]);
  hdr.font = { bold: true, color: { argb: XL.white } };
  hdr.alignment = { wrapText: true, vertical: "middle" };
  hdr.height = 36;
  hdr.eachCell({ includeEmpty: true }, (c) => (c.fill = solid(XL.navy)));
  const headerRow = hdr.number;
  const rows: Record<string, number> = {};
  const cat = (ci: number) => `${colLetter(2 + ci)}$${headerRow}`;
  const sumifs = (col: string, ci: number, extra = "", table = "tblLevel2") => `SUMIFS(${table}[${col}],${table}[Category],${cat(ci)}${extra})`;
  const group = (label: string) => sectionRow(ws, label, MOVE, XL.navyLight);
  const line = (key: string, label: string, perCat: (ci: number) => string, prev: (ci: number) => string | null, strong = false, muted = false, signed = false) => {
    const r = ws.addRow([label]);
    rows[key] = r.number;
    cats.forEach((_, ci) => (r.getCell(2 + ci).value = { formula: perCat(ci), result: undefined }));
    r.getCell(TOTAL).value = { formula: `SUM(${colLetter(2)}${r.number}:${colLetter(1 + cats.length)}${r.number})`, result: undefined };
    const p = prev(0);
    if (p !== null) {
      r.getCell(PREV).value = { formula: `IF(PrevReportNo=0,"",${cats.map((_, ci) => prev(ci)).join("+")})`, result: undefined };
      r.getCell(MOVE).value = { formula: `IF(PrevReportNo=0,"",${colLetter(TOTAL)}${r.number}-${colLetter(PREV)}${r.number})`, result: undefined };
    }
    for (let c = 2; c <= MOVE; c++) r.getCell(c).numFmt = signed ? "#,##0;[Red](#,##0);-" : WHOLE;
    if (strong) {
      r.font = { bold: true, color: { argb: XL.navy } };
      r.eachCell({ includeEmpty: true }, (c) => (c.fill = solid(XL.subtotalFill)));
    }
    if (muted) r.font = { italic: true, color: { argb: XL.muted } };
    r.getCell(TOTAL).font = { bold: true, color: { argb: XL.navy } };
    return r.number;
  };
  const snap = (col: string, ci: number, extra = "") => `SUMIFS(tblSnapshots[${col}],tblSnapshots[Category],${cat(ci)},tblSnapshots[Report No],PrevReportNo${extra})`;
  const ref = (key: string, ci: number) => `${colLetter(2 + ci)}${rows[key]}`;
  group("Development Budget");
  line("E", "Previous Approved Budget", (ci) => sumifs("E", ci), (ci) => snap("E", ci), false, true);
  line("F", "Approved Budget Transfers", (ci) => sumifs("F", ci), (ci) => snap("F", ci), false, true);
  line("G", "Development Budget (currently approved)", (ci) => `${ref("E", ci)}+${ref("F", ci)}`, (ci) => snap("G", ci), true);
  group("Commitments");
  line("awards", "Contract Awards", (ci) => sumifs("G", ci, `,tblLevel2[Section],"Committed",tblLevel2[Budget hold],"No"`), (ci) => snap("G", ci, `,tblSnapshots[Section],"Committed",tblSnapshots[Budget hold],"No"`));
  line("H", "DVO's (Determined Variation Orders)", (ci) => sumifs("H", ci, `,tblLevel2[Budget hold],"No"`), (ci) => snap("H", ci, `,tblSnapshots[Budget hold],"No"`));
  line("committed", "Committed", (ci) => `${ref("awards", ci)}+${ref("H", ci)}`, (ci) => `(${snap("G", ci, `,tblSnapshots[Section],"Committed",tblSnapshots[Budget hold],"No"`)}+${snap("H", ci, `,tblSnapshots[Budget hold],"No"`)})`, true);
  group("Potential Out-Turn Costs");
  line("J", "PVO's (Potential Variation Orders)", (ci) => sumifs("J", ci, `,tblLevel2[Budget hold],"No"`), (ci) => snap("J", ci, `,tblSnapshots[Budget hold],"No"`));
  line("K", "RFC's (Requests for Change)", (ci) => sumifs("K", ci, `,tblLevel2[Budget hold],"No"`), (ci) => snap("K", ci, `,tblSnapshots[Budget hold],"No"`));
  line("L", "Early Warnings", (ci) => sumifs("L", ci, `,tblLevel2[Budget hold],"No"`), (ci) => snap("L", ci, `,tblSnapshots[Budget hold],"No"`));
  line("M", "Claims", (ci) => sumifs("M", ci, `,tblLevel2[Budget hold],"No"`), (ci) => snap("M", ci, `,tblSnapshots[Budget hold],"No"`));
  group("Balance to Procure");
  line("uncommitted", "Uncommitted Packages", (ci) => sumifs("G", ci, `,tblLevel2[Section],"Uncommitted",tblLevel2[Budget hold],"No"`), (ci) => snap("G", ci, `,tblSnapshots[Section],"Uncommitted",tblSnapshots[Budget hold],"No"`));
  line("N", "Anticipated Final Account", (ci) => `${ref("committed", ci)}+${ref("uncommitted", ci)}+${ref("J", ci)}+${ref("K", ci)}+${ref("L", ci)}+${ref("M", ci)}`, (ci) => snap("N", ci, `,tblSnapshots[Budget hold],"No"`), true);
  line("O", "Variance to Budget", (ci) => `${ref("N", ci)}-${ref("G", ci)}`, (ci) => `(${snap("N", ci, `,tblSnapshots[Budget hold],"No"`)}-${snap("G", ci)})`, true, false, true);
  group("Cash Position");
  line("P", "Certified to Date", (ci) => sumifs("P", ci, `,tblLevel2[Budget hold],"No"`), (ci) => snap("P", ci, `,tblSnapshots[Budget hold],"No"`));
  line("Q", "Works to Complete", (ci) => `${ref("N", ci)}-${ref("P", ci)}`, (ci) => `(${snap("N", ci, `,tblSnapshots[Budget hold],"No"`)}-${snap("P", ci, `,tblSnapshots[Budget hold],"No"`)})`);
  group("Comparison with the previous issued report");
  line("prevN", "Previous report – Anticipated Final Account", (ci) => `IF(PrevReportNo=0,0,${snap("N", ci, `,tblSnapshots[Budget hold],"No"`)})`, () => null, false, true);
  line("S", "Period movement (this report − previous)", (ci) => `${ref("N", ci)}-${ref("prevN", ci)}`, () => null, true, false, true);
  ws.addRow([]);
  const chk = ws.addRow(["Check: Anticipated Final Account total − Level 2 total N excluding budget hold (must be zero)"]);
  chk.getCell(TOTAL).value = { formula: `${colLetter(TOTAL)}${rows.N}-SUMIFS(tblLevel2[N],tblLevel2[Budget hold],"No")`, result: undefined };
  chk.font = { italic: true, size: 9, color: { argb: XL.muted } };
  chk.getCell(TOTAL).numFmt = WHOLE;
  const note = ws.addRow([`Categories run across as on the Excel "Level 01" sheet. Budget lines include the unallocated hold; every other line excludes it. Previous-report figures come from the stored copy of Report No shown on the Setup sheet as the previous issued report.`]);
  note.font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.getColumn(1).width = 46;
  for (let c = 2; c <= MOVE; c++) ws.getColumn(c).width = 18;
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 1 }];
  for (const [key, row] of Object.entries(rows)) names.add(`L1_${key}`, "Level 1", `$${colLetter(TOTAL)}$${row}`);
  void seed;
  return { rows, totalCol: TOTAL, headerRow, nCats: cats.length };
}

function movementSheet(wb: ExcelJS.Workbook, names: Names, l1: { rows: Record<string, number>; totalCol: number }, nLines: number) {
  const ws = sheet(wb, "Movement");
  [18, 40, 26, 18, 18, 18, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  titleBlock(ws, "Movement since the previous issued report", "Cost report columns and every Level 2 line, this report against the stored copy of the previous report", 7);
  const hdr = ws.addRow(["Cost report line", "", "", "Previous report", "This report", "Movement", ""]);
  hdr.font = { bold: true, color: { argb: XL.white } };
  hdr.eachCell({ includeEmpty: true }, (c) => (c.fill = solid(XL.navy)));
  const T = colLetter(l1.totalCol);
  const P = colLetter(l1.totalCol + 1);
  const items: [string, string][] = [
    ["G  Development budget", "G"],
    ["H  Determined variation orders", "H"],
    ["J  Potential variation orders", "J"],
    ["K  Requests for change", "K"],
    ["L  Early warnings", "L"],
    ["M  Claims", "M"],
    ["N  Anticipated final account", "N"],
    ["O  Variance to budget", "O"],
    ["P  Certified to date", "P"],
  ];
  for (const [label, key] of items) {
    const r = ws.addRow([label]);
    ws.mergeCells(r.number, 1, r.number, 3);
    r.getCell(4).value = { formula: `'Level 1'!${P}${l1.rows[key]}`, result: undefined };
    r.getCell(5).value = { formula: `'Level 1'!${T}${l1.rows[key]}`, result: undefined };
    r.getCell(6).value = { formula: `IF(D${r.number}="","",E${r.number}-D${r.number})`, result: undefined };
    [4, 5, 6].forEach((c) => (r.getCell(c).numFmt = WHOLE));
    if (key === "N" || key === "O") r.font = { bold: true, color: { argb: XL.navy } };
  }
  ws.addRow([]);
  sectionRow(ws, "Level 2 lines – previous report vs this report (rebuilt by the workbook after each import)", 7, XL.navyLight);
  const h2 = ws.addRow(["Code", "Name", "Package", "Previous N", "This report N", "Movement", "What happened"]);
  h2.font = { bold: true, color: { argb: XL.white } };
  h2.eachCell({ includeEmpty: true }, (c) => (c.fill = solid(XL.navy)));
  const first = h2.number + 1;
  ws.getCell(1, 9).value = first;
  ws.getCell(1, 9).font = { color: { argb: XL.navy }, size: 8 };
  names.add("MovementFirstRow", "Movement", "$I$1");
  for (let i = 1; i <= nLines; i++) {
    const rn = first + i - 1;
    ws.getCell(rn, 1).value = { formula: `INDEX(tblLevel2[Code],${i})`, result: undefined };
    ws.getCell(rn, 2).value = { formula: `INDEX(tblLevel2[Name],${i})`, result: undefined };
    ws.getCell(rn, 3).value = { formula: `INDEX(tblLevel2[Package],${i})`, result: undefined };
    ws.getCell(rn, 4).value = { formula: `INDEX(tblLevel2[R],${i})`, result: undefined };
    ws.getCell(rn, 5).value = { formula: `INDEX(tblLevel2[N],${i})`, result: undefined };
    ws.getCell(rn, 6).value = { formula: `E${rn}-D${rn}`, result: undefined };
    ws.getCell(rn, 7).value = { formula: `IF(F${rn}=0,"",IF(D${rn}=0,"new line",IF(E${rn}=0,"line removed",IF(F${rn}>0,"increase","decrease"))))`, result: undefined };
    [4, 5, 6].forEach((c) => (ws.getCell(rn, c).numFmt = WHOLE));
    ws.getRow(rn).font = { size: 9 };
  }
  ws.views = [{ state: "frozen", ySplit: hdr.number }];
}

function homeSheet(wb: ExcelJS.Workbook, names: Names, seed: Seed, charts: XlsxChart[], l1: { rows: Record<string, number>; totalCol: number; headerRow: number; nCats: number }) {
  const ws = sheet(wb, "Home");
  ws.views = [{ showGridLines: false }];
  const COLS = 18;
  for (let c = 1; c <= COLS; c++) ws.getColumn(c).width = 10.5;
  titleBlock(ws, `Commercial Dashboard – Excel edition`, `${seed.programme.code} · ${seed.programme.name}${seed.asset.code ? ` · ${seed.asset.code} ${seed.asset.name}` : ""}`, COLS);
  ws.getCell("A3").value = { formula: `"Signed in as "&SignedInUser&" ("&SignedInRole&")  ·  "&CurrentPeriodLabel&"  ·  cut-off "&TEXT(CurrentPeriodEnd,"dd-mmm-yy")&"  ·  "&CurrentPeriodStatus`, result: undefined };
  ws.getCell("A3").font = { bold: true, color: { argb: XL.navy } };
  ws.mergeCells("A3:R3");
  // buttons (created by the workbook on the first sign in) sit on these anchors
  sectionRow(ws, "Actions", COLS, XL.navyLight);
  ws.getRow(5).height = 26;
  ws.getRow(6).height = 26;
  ws.addRow([]);
  ws.getRow(7).height = 26;
  const anchors: [string, string][] = [["ButtonsRow1", "A5"], ["ButtonsRow1b", "C5"], ["ButtonsRow1c", "E5"], ["ButtonsRow1d", "G5"], ["ButtonsRow1e", "I5"], ["ButtonsRow1f", "L5"], ["ButtonsRow2", "A6"], ["ButtonsRow2b", "D6"], ["ButtonsRow2c", "G6"], ["ButtonsRow2d", "J6"], ["ButtonsRow2e", "M6"], ["ButtonsRow2f", "P6"], ["ButtonsRow3", "A7"], ["ButtonsRow3b", "E7"]];
  for (const [n, cell] of anchors) names.add(n, "Home", `$${cell.replace(/(\d+)/, "$$$1")}`);
  ws.addRow([]);
  // headline tiles
  sectionRow(ws, "Cost position (SAR) – from the Level 1 sheet", COLS, XL.navy);
  const t1 = 10;
  tile(ws, t1, 1, 3, "Approved baseline budget", "L1_E", TILE.navy, WHOLE, "column E");
  tile(ws, t1, 4, 3, "Latest budget", "L1_G", TILE.teal, WHOLE, "E + transfers");
  tile(ws, t1, 7, 3, "Anticipated final account", "L1_N", TILE.orange, WHOLE, "column N");
  tile(ws, t1, 10, 3, "Variance to budget", "L1_O", TILE.green, WHOLE, "N − G (negative = under budget)");
  tile(ws, t1, 13, 3, "Certified to date", "L1_P", TILE.purple, WHOLE, "column P");
  tile(ws, t1, 16, 3, "Period movement", "L1_S", TILE.blue, WHOLE, "vs the previous issued report");
  while (ws.rowCount < t1 + 3) ws.addRow([]);
  ws.addRow([]);
  sectionRow(ws, "Open items – counted on the module sheets", COLS, XL.navyLight);
  const t2 = ws.rowCount + 1;
  tile(ws, t2, 1, 3, "Open change items", `COUNTIF(tblChanges[Closed],"No")`, TILE.blue, "0", "Changes sheet");
  tile(ws, t2, 4, 3, "Open early warnings", `COUNTIF(tblEW[Status],"Open")`, TILE.gold, "0", "Early Warnings sheet");
  tile(ws, t2, 7, 3, "Pending claims", `COUNTIF(tblClaims[Status],"Pending")`, TILE.orange, "0", "Claims sheet");
  tile(ws, t2, 10, 3, "Bonds expired (live contracts)", `COUNTIF(tblBonds[Status],"Expired")`, TILE.red, "0", "Bonds sheet");
  tile(ws, t2, 13, 3, "Open risks", `COUNTIFS(tblRisks[Type],"Risk",tblRisks[Status],"Open")+COUNTIFS(tblRisks[Type],"Risk",tblRisks[Status],"Mitigating")`, TILE.purple, "0", "Risks sheet");
  tile(ws, t2, 16, 3, "Open actions", `COUNTIF(tblActions[Status],"Open")+COUNTIF(tblActions[Status],"In progress")`, TILE.teal, "0", "Actions sheet");
  while (ws.rowCount < t2 + 3) ws.addRow([]);
  ws.addRow([]);
  // module links
  sectionRow(ws, "Modules – click to open", COLS, XL.navyLight);
  const links = ["Setup", "Periods", "Level 1", "Level 2", "Movement", "Changes", "Claims", "Early Warnings", "Risks", "Provisional Sums", "Bonds", "Contracts", "IPCs", "Final Accounts", "Cash Flow", "Transfers", "Actions", "Users"];
  const linkRow = ws.rowCount + 1;
  links.forEach((s, i) => {
    const r = linkRow + Math.floor(i / 6);
    const c = 1 + (i % 6) * 3;
    const cell = ws.getCell(r, c);
    cell.value = { text: `▸ ${s}`, hyperlink: `#'${s}'!A1` };
    cell.font = { color: { argb: XL.accent }, underline: true, bold: true, size: 10 };
    ws.mergeCells(r, c, r, c + 2);
  });
  while (ws.rowCount < linkRow + Math.ceil(links.length / 6)) ws.addRow([]);
  ws.addRow([]);
  sectionRow(ws, "Charts – live Excel charts over the tables", COLS, XL.navy);
  const chartTop = ws.rowCount; // 0-based anchor row
  const CH = 17;
  while (ws.rowCount < chartTop + CH * 2 + 2) ws.addRow([]);
  ws.addRow([]);
  // data behind the charts
  sectionRow(ws, "Data behind the charts", COLS, XL.navyLight);
  const dTop = ws.rowCount + 2;
  const small = (row: number, col: number, title: string, headers: string[], body: (ExcelJS.CellValue | { formula: string })[][], fmts: (string | undefined)[]) => {
    ws.getCell(row, col).value = title;
    ws.getCell(row, col).font = { bold: true, color: { argb: XL.navy } };
    headers.forEach((h, i) => {
      const c = ws.getCell(row + 1, col + i);
      c.value = h;
      c.font = { bold: true, color: { argb: XL.white }, size: 9 };
      c.fill = solid(XL.navyLight);
    });
    body.forEach((r, ri) =>
      r.forEach((v, i) => {
        const c = ws.getCell(row + 2 + ri, col + i);
        c.value = v as ExcelJS.CellValue;
        if (fmts[i]) c.numFmt = fmts[i]!;
        c.border = { bottom: { style: "hair", color: { argb: XL.line } } };
      }),
    );
    return { first: row + 2, last: row + 1 + body.length };
  };
  const f = (formula: string) => ({ formula, result: undefined });
  const build = small(dTop, 1, "Anticipated final account build-up", ["Element", "", "SAR"], [
    ["Latest budget (G)", "", f("L1_G")],
    ["Determined VOs (H)", "", f("L1_H")],
    ["Potential VOs (J)", "", f("L1_J")],
    ["Requests for change (K)", "", f("L1_K")],
    ["Early warnings (L)", "", f("L1_L")],
    ["Claims (M)", "", f("L1_M")],
  ], [undefined, undefined, WHOLE]);
  for (let r = build.first - 1; r <= build.last; r++) ws.mergeCells(r, 1, r, 2);
  const cats = small(dTop, 5, "Budget vs anticipated final account by category", ["Category", "", "Budget (G)", "AFA (N)"], CATEGORIES.map((c, i) => [c, "", f(`'Level 1'!${colLetter(2 + i)}${l1.rows.G}`), f(`'Level 1'!${colLetter(2 + i)}${l1.rows.N}`)]), [undefined, undefined, WHOLE, WHOLE]);
  for (let r = cats.first - 1; r <= cats.last; r++) ws.mergeCells(r, 5, r, 6);
  const bondRows: [string, string, string][] = [["Active", "Active", CHART_COLORS.green], ["Expiring", "Expiring", CHART_COLORS.amber], ["Expired", "Expired", CHART_COLORS.red], ["Released (contract closed)", "Released*", CHART_COLORS.grey]];
  const bonds = small(dTop, 10, "Bonds & insurance by status", ["Status", "", "Count"], bondRows.map(([l, pat]) => [l, "", f(`COUNTIF(tblBonds[Status],"${pat}")`)]), [undefined, undefined, "0"]);
  for (let r = bonds.first - 1; r <= bonds.last; r++) ws.mergeCells(r, 10, r, 11);
  const stages = ["RFC", "PVO", "VO", "DVO"];
  const stg = small(dTop, 14, "Change status by stage", ["Stage", "Approved", "Pending", "Cancelled", "Other"], stages.map((s) => [
    s,
    f(`COUNTIF(tblChanges[${s} status],"Approved")+COUNTIF(tblChanges[${s} status],"Review Complete")`),
    f(`COUNTIF(tblChanges[${s} status],"Pending")+COUNTIF(tblChanges[${s} status],"Revised & Re-submit")`),
    f(`COUNTIF(tblChanges[${s} status],"Cancelled")+COUNTIF(tblChanges[${s} status],"Superseded")`),
    f(`COUNTA(tblChanges[${s} status])-COUNTIF(tblChanges[${s} status],"Approved")-COUNTIF(tblChanges[${s} status],"Review Complete")-COUNTIF(tblChanges[${s} status],"Pending")-COUNTIF(tblChanges[${s} status],"Revised & Re-submit")-COUNTIF(tblChanges[${s} status],"Cancelled")-COUNTIF(tblChanges[${s} status],"Superseded")`),
  ]), [undefined, "0", "0", "0", "0"]);
  const bottom = Math.max(build.last, cats.last, bonds.last, stg.last) + 2;
  const claimRows = ["Pending", "Approved", "Rejected"];
  const cl = small(bottom, 1, "Claims by status (SAR claimed)", ["Status", "", "Claims", "SAR claimed"], claimRows.map((s) => [s, "", f(`COUNTIF(tblClaims[Status],"${s}*")`), f(`SUMIFS(tblClaims[Contractor cost],tblClaims[Status],"${s}*")`)]), [undefined, undefined, "0", WHOLE]);
  for (let r = cl.first - 1; r <= cl.last; r++) ws.mergeCells(r, 1, r, 2);
  const nCf = Math.max(1, seed.cashflow.length);
  const cfFirst = bottom;
  ws.getCell(cfFirst, 7).value = "Cash flow – cumulative (from the Cash Flow sheet)";
  ws.getCell(cfFirst, 7).font = { bold: true, color: { argb: XL.navy } };
  ["Month", "Cum. forecast", "Cum. actual"].forEach((h, i) => {
    const c = ws.getCell(cfFirst + 1, 7 + i);
    c.value = h;
    c.font = { bold: true, color: { argb: XL.white }, size: 9 };
    c.fill = solid(XL.navyLight);
  });
  for (let i = 1; i <= nCf; i++) {
    ws.getCell(cfFirst + 1 + i, 7).value = f(`INDEX(tblCashFlow[Month],${i})`);
    ws.getCell(cfFirst + 1 + i, 7).numFmt = "mmm'yy";
    ws.getCell(cfFirst + 1 + i, 8).value = f(`INDEX(tblCashFlow[Cum. forecast],${i})`);
    ws.getCell(cfFirst + 1 + i, 9).value = f(`INDEX(tblCashFlow[Cum. actual],${i})`);
    [8, 9].forEach((c) => (ws.getCell(cfFirst + 1 + i, c).numFmt = WHOLE));
  }
  const cfLast = cfFirst + 1 + nCf;
  while (ws.rowCount < Math.max(cl.last, cfLast) + 1) ws.addRow([]);
  const foot = ws.addRow([`Generated by ${APP_NAME} · sign in on the Login sheet · all amounts SAR`]);
  foot.font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.mergeCells(foot.number, 1, foot.number, COLS);
  // the charts
  const rg = (col: number, r1: number, r2: number) => `'Home'!$${colLetter(col)}$${r1}:$${colLetter(col)}$${r2}`;
  const row1 = chartTop;
  const row2 = chartTop + CH + 1;
  charts.push(
    { type: "doughnut", title: "Anticipated final account build-up", categories: rg(1, build.first, build.last), catCache: ["Latest budget (G)", "Determined VOs (H)", "Potential VOs (J)", "Requests for change (K)", "Early warnings (L)", "Claims (M)"], series: [{ name: "SAR", values: rg(3, build.first, build.last), cache: [0, 0, 0, 0, 0, 0] }], pointColors: [CHART_COLORS.navy, CHART_COLORS.blue, CHART_COLORS.teal, CHART_COLORS.gold, CHART_COLORS.amber, CHART_COLORS.red], from: { col: 0, row: row1 }, to: { col: 6, row: row1 + CH } },
    { type: "bar", title: "Budget vs anticipated final account by category", categories: rg(5, cats.first, cats.last), catCache: CATEGORIES, series: [{ name: "Development budget (G)", values: rg(7, cats.first, cats.last), cache: CATEGORIES.map(() => 0), color: CHART_COLORS.blue }, { name: "Anticipated final account (N)", values: rg(8, cats.first, cats.last), cache: CATEGORIES.map(() => 0), color: CHART_COLORS.orange }], from: { col: 6, row: row1 }, to: { col: 12, row: row1 + CH }, numFmt: "#,##0" },
    { type: "doughnut", title: "Bonds & insurance by status", categories: rg(10, bonds.first, bonds.last), catCache: bondRows.map((b) => b[0]), series: [{ name: "Bonds / policies", values: rg(12, bonds.first, bonds.last), cache: [0, 0, 0, 0] }], pointColors: bondRows.map((b) => b[2]), from: { col: 12, row: row1 }, to: { col: 18, row: row1 + CH } },
    { type: "stackedBar", title: "Change status by stage", categories: rg(14, stg.first, stg.last), catCache: stages, series: ["Approved", "Pending", "Cancelled", "Other"].map((n, i) => ({ name: n, values: rg(15 + i, stg.first, stg.last), cache: stages.map(() => 0), color: [CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.grey, CHART_COLORS.purple][i] })), from: { col: 0, row: row2 }, to: { col: 6, row: row2 + CH }, showValues: true, numFmt: "0" },
    { type: "bar", title: "Claims by status (SAR claimed)", categories: rg(1, cl.first, cl.last), catCache: claimRows, series: [{ name: "SAR claimed", values: rg(4, cl.first, cl.last), cache: [0, 0, 0], color: CHART_COLORS.teal }], from: { col: 6, row: row2 }, to: { col: 12, row: row2 + CH }, numFmt: "#,##0", showValues: true, legend: false },
    { type: "line", title: "Cash flow – cumulative forecast vs actual", categories: rg(7, cfFirst + 2, cfLast), catCache: seed.cashflow.map((m) => m.month.toISOString().slice(0, 7)), series: [{ name: "Cumulative forecast", values: rg(8, cfFirst + 2, cfLast), cache: seed.cashflow.map(() => 0), color: CHART_COLORS.blue }, { name: "Cumulative actual", values: rg(9, cfFirst + 2, cfLast), cache: seed.cashflow.map(() => 0), color: CHART_COLORS.green }], from: { col: 12, row: row2 }, to: { col: 18, row: row2 + CH }, numFmt: "#,##0" },
  );
}

/* ------------------------------------------------------------------ the workbook */

export async function renderExcelEdition(programmeId: number): Promise<Buffer> {
  const seed = loadSeed(programmeId);
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  const definedNames: [string, string, string][] = [];
  const names: Names = { add: (name, sheet, cell) => definedNames.push([name, sheet, cell]) };
  const charts: XlsxChart[] = [];
  const subtitle = `${seed.programme.code} · ${seed.programme.name} · loaded from the dashboard on ${new Date().toISOString().slice(0, 10)}`;

  for (const n of SHEETS_ORDER) wb.addWorksheet(n); // created up front so the tab order is fixed
  loginSheet(wb, names, seed);
  setupSheet(wb, names, seed);
  // Periods
  tableSheet(wb, PERIODS, seed.periods.map((p) => PERIODS.cols.map((c) => cellValue(c, p, seed))), { subtitle });
  const l1 = level1Sheet(wb, names, seed);
  // Level 2 from the live cost lines register
  const costLines = seed.rows.cost_lines.slice().sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  tableSheet(wb, LEVEL2, costLines.map((r) => LEVEL2.cols.map((c) => cellValue(c, r, seed))), { subtitle, before: (ws) => ws.addRow(["Money columns F to S are formulas over the other sheets (transfers, changes, early warnings, claims, contracts, stored copies). Enter E and Opening transfers; everything else calculates."]).font = { italic: true, size: 9, color: { argb: XL.muted } } });
  movementSheet(wb, names, l1, Math.max(1, costLines.length));
  // registers
  const regSpecs: [TableSpec, RecordRow[]][] = [
    [CHANGES, seed.rows.changes],
    [CLAIMS, seed.rows.claims],
    [EW, seed.rows.early_warnings],
    [RISKS, seed.rows.risks],
    [PS, seed.rows.provisional_sums],
    [BONDS, seed.rows.bonds],
    [CONTRACTS, seed.rows.contracts],
    [IPC, seed.rows.payment_applications],
    [FA, seed.rows.final_accounts],
    [TRANSFERS, seed.rows.budget_transfers],
  ];
  for (const [spec, rows] of regSpecs) tableSheet(wb, spec, rows.map((r) => spec.cols.map((c) => cellValue(c, r, seed))), { subtitle });
  tableSheet(wb, CASHFLOW, seed.cashflow.map((m) => [m.month, m.forecast || null, null, null, null, null]), { subtitle: `${subtitle} · Actual = net payments by paid date from the IPC log; type the forecast per month` });
  tableSheet(wb, ACTIONS, seed.rows.actions.map((r) => ACTIONS.cols.map((c) => cellValue(c, r, seed))), { subtitle });
  // stored copies
  const snapRows: ExcelJS.CellValue[][] = [];
  for (const s of seed.snapshots) for (const l of s.lines) snapRows.push([s.reportNo, l.code, l.package ?? "", l.name ?? "", l.category ?? "", l.section ?? "", l.is_budget_hold ? "Yes" : "No", l.E, l.F, l.G, l.H, l.I, l.J, l.K, l.L, l.M, l.N, l.O, l.P, l.Q]);
  tableSheet(wb, SNAPSHOTS, snapRows, { subtitle: `${subtitle} · written by "Lock period" / "New month"; the Previous columns read the latest stored report before the current one` });
  // users
  const userRows = seed.users.map((u) => [u.name, u.email, u.role, u.active ? "Yes" : "No", hashPassword(u.role === "admin" ? "Admin@123" : "Welcome@123"), "Yes", null]);
  if (!userRows.some((u) => u[2] === "admin")) userRows.unshift(["Administrator", "admin@commercial.local", "admin", "Yes", hashPassword("Admin@123"), "Yes", null]);
  const usersWs = tableSheet(wb, USERS, userRows, { subtitle: "Add a row for a new user (or use the buttons); passwords are stored as one-way hashes", before: (ws) => { ws.addRow([]); names.add("UsersButtons", "Users", "$A$4"); names.add("UsersButtons2", "Users", "$C$4"); ws.getRow(4).height = 26; } });
  usersWs.ws.getColumn(5).hidden = true;
  tableSheet(wb, ACTIVITY, [[new Date(), "dashboard", "Workbook generated", `Loaded from ${APP_NAME}: Report No ${seed.currentReportNo}`]], { subtitle: "Newest first" });
  listsSheet(wb);
  homeSheet(wb, names, seed, charts, l1);
  // tab order, visibility, names
  const ordered = SHEETS_ORDER.map((n) => wb.getWorksheet(n)).filter((w): w is ExcelJS.Worksheet => !!w);
  for (const ws of ordered) {
    ws.state = ws.name === "Login" ? "visible" : "veryHidden";
    ws.properties.tabColor = { argb: ws.name === "Home" ? XL.accent : ws.name === "Login" ? XL.navy : XL.navyLight };
  }
  definedNames.push(["EarSystemPrompt", "Lists", "$AD$2"], ["EarRevisionRules", "Lists", "$AE$2"], ["EarSchema", "Lists", "$AF$2"]);
  for (const [name, sheet, cell] of definedNames) wb.definedNames.add(`'${sheet}'!${cell}`, name);
  wb.calcProperties.fullCalcOnLoad = true;
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const withCharts = await addChartsToXlsx(xlsx, { Home: charts });
  return toMacroWorkbook(withCharts, ordered.map((w) => w.name));
}

/* ------------------------------------------------------------------ .xlsm packaging */

function vbaDir(): string {
  const candidates = [path.join(process.cwd(), "src", "lib", "excel-app", "vba"), path.join(__dirname, "vba")];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("VBA modules not found");
}

const codeName = (sheet: string) => "sht" + sheet.replace(/[^A-Za-z0-9]/g, "");

async function toMacroWorkbook(xlsx: Buffer, sheets: string[]): Promise<Buffer> {
  const dir = vbaDir();
  const modules: VbaModule[] = [
    { name: "ThisWorkbook", type: "document", code: "Option Explicit\r\n\r\nPrivate Sub Workbook_Open()\r\n    modMain.AppStart\r\nEnd Sub\r\n" },
    ...sheets.map((s) => ({ name: codeName(s), type: "document" as const, code: "Option Explicit\r\n" })),
    ...["modUtil", "modJson", "modAuth", "modMain", "modPeriods", "modImport", "modImportGeneric", "modReports", "modPresentation", "modEar"].map((m) => ({ name: m, type: "standard" as const, code: fs.readFileSync(path.join(dir, `${m}.bas`), "utf8") })),
  ];
  const bin = buildVbaProject(modules, { projectName: "CommercialDashboard" });
  const zip = await JSZip.loadAsync(xlsx);
  // content types
  let ct = await zip.file("[Content_Types].xml")!.async("string");
  ct = ct.replace("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", "application/vnd.ms-excel.sheet.macroEnabled.main+xml");
  if (!ct.includes("vbaProject.bin")) ct = ct.replace("</Types>", `<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>`);
  zip.file("[Content_Types].xml", ct);
  // relationship and part
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  zip.file("xl/_rels/workbook.xml.rels", rels.replace("</Relationships>", `<Relationship Id="rIdVBA" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>`));
  zip.file("xl/vbaProject.bin", bin);
  // code names
  let wbXml = await zip.file("xl/workbook.xml")!.async("string");
  wbXml = /<workbookPr\b/.test(wbXml) ? wbXml.replace(/<workbookPr\b/, `<workbookPr codeName="ThisWorkbook"`) : wbXml.replace(/(<fileVersion\b[^>]*\/>)/, `$1<workbookPr codeName="ThisWorkbook"/>`);
  zip.file("xl/workbook.xml", wbXml);
  // sheet part -> sheet name
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) target.set(m[1], m[2]);
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    const rid = /r:id="([^"]*)"/.exec(m[0])?.[1];
    const t = rid ? target.get(rid) : undefined;
    if (!name || !t) continue;
    const file = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
    let xml = await zip.file(file)!.async("string");
    const cn = codeName(name);
    xml = /<sheetPr\b/.test(xml) ? xml.replace(/<sheetPr\b/, `<sheetPr codeName="${cn}"`) : xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr codeName="${cn}"/>`);
    zip.file(file, xml);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** The VBA source files as a zip (fallback: import them through the VBA editor if the embedded project is refused). */
export async function excelEditionModulesZip(): Promise<Buffer> {
  const dir = vbaDir();
  const zip = new JSZip();
  for (const m of ["modUtil", "modJson", "modAuth", "modMain", "modPeriods", "modImport", "modImportGeneric", "modReports", "modPresentation", "modEar"]) zip.file(`${m}.bas`, `Attribute VB_Name = "${m}"\r\n` + fs.readFileSync(path.join(dir, `${m}.bas`), "utf8").replace(/\r?\n/g, "\r\n"));
  zip.file("ThisWorkbook.txt", "Option Explicit\r\n\r\nPrivate Sub Workbook_Open()\r\n    modMain.AppStart\r\nEnd Sub\r\n");
  zip.file(
    "README.txt",
    [
      "Commercial Dashboard – Excel edition: VBA modules",
      "",
      "Only needed if Excel says the macros in the downloaded .xlsm cannot be read.",
      "1. Open the .xlsm, press Alt+F11 to open the VBA editor.",
      "2. File > Import File… and import each .bas file (modUtil first).",
      "3. Double-click ThisWorkbook in the project tree and paste the contents of ThisWorkbook.txt.",
      "4. Save as .xlsm, close and reopen the file, then sign in.",
    ].join("\r\n"),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
