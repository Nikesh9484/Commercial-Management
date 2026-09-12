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
import { addChartsToXlsx, type XlsxChart, type XlsxShape } from "../xlsx-charts";
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

/* ------------------------------------------------------------------ the premium look */

/** Gradient pairs (top → bottom) for the tiles, bands and buttons. */
const GRAD = {
  navy: ["FF1E3F6E", "FF0F2B4C"], teal: ["FF19A3AE", "FF0B6670"], orange: ["FFF58A5A", "FFD9552A"], green: ["FF3FB86F", "FF1F7F45"],
  red: ["FFE86060", "FFB83535"], blue: ["FF3E8DF0", "FF1F5FB8"], purple: ["FF9271D6", "FF5F41A6"], gold: ["FFE0B84A", "FFAE8A18"],
  band: ["FF1F4F8F", "FF0F2B4C"], bandLight: ["FF2F6DB5", "FF1F4F8F"], header: ["FF0F2B4C", "FF0E5C80"], card: ["FFFFFFFF", "FFF3F7FC"],
} as const;
const gradient = (colors: readonly string[], degree = 90): ExcelJS.Fill => ({ type: "gradient", gradient: "angle", degree, stops: colors.map((c, i) => ({ position: i / (colors.length - 1), color: { argb: c } })) });
/** Darker bottom/right edges so a block of cells reads as a raised card. */
function raised(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number, dark = "FF0B1B33", light = "FFFFFFFF") {
  for (let c = c1; c <= c2; c++) {
    const top = ws.getCell(r1, c);
    top.border = { ...top.border, top: { style: "thin", color: { argb: light } } };
    const bottom = ws.getCell(r2, c);
    bottom.border = { ...bottom.border, bottom: { style: "medium", color: { argb: dark } } };
  }
  for (let r = r1; r <= r2; r++) {
    const left = ws.getCell(r, c1);
    left.border = { ...left.border, left: { style: "thin", color: { argb: light } } };
    const right = ws.getCell(r, c2);
    right.border = { ...right.border, right: { style: "medium", color: { argb: dark } } };
  }
}
/** A gradient band across the sheet (title / section). */
function band(ws: ExcelJS.Worksheet, row: number, span: number, colors: readonly string[]) {
  for (let c = 1; c <= span; c++) ws.getCell(row, c).fill = gradient(colors, 90);
  raised(ws, row, 1, row, span, "FF07162B", "FF3E7BC6");
}
/** A glossy button shape wired to a macro; the workbook's VBA only sets .OnAction on a shape named like the caption. */
const colEmu = (ws: ExcelJS.Worksheet, col: number) => Math.trunc((ws.getColumn(col).width ?? 8.43) * 7 + 5) * 9525;
const rowEmu = (ws: ExcelJS.Worksheet, row: number) => Math.round((ws.getRow(row).height ?? 15) * 12700);
/** A glossy button shape wired to a macro, filling the cells col..col+span-1 on the given row (1-based); the VBA only sets .OnAction on a shape named like the caption. */
function button(ws: ExcelJS.Worksheet, name: string, macro: string, colors: readonly string[], col: number, span: number, row: number, opts: { icon?: string; fontSize?: number; glow?: string; rows?: number } = {}): XlsxShape {
  const m = 28000;
  const lastRow = row + (opts.rows ?? 1) - 1;
  return {
    kind: "roundRect", name, macro, text: opts.icon ? `${opts.icon}  ${name}` : name, textColor: "FFFFFF", fontSize: opts.fontSize ?? 10, bold: true,
    colors: colors.map((c) => c.slice(-6)), angle: 90, shadow: true, bevel: true, glow: opts.glow, radius: 0.35,
    from: { col: col - 1, row: row - 1, colOff: m, rowOff: m }, to: { col: col + span - 2, row: lastRow - 1, colOff: Math.max(m, colEmu(ws, col + span - 1) - m), rowOff: Math.max(m, rowEmu(ws, lastRow) - m) },
  };
}
/** A translucent decorative blob. */
function blob(name: string, kind: XlsxShape["kind"], color: string, alpha: number, from: { col: number; row: number }, to: { col: number; row: number }, angle = 45): XlsxShape {
  return { kind, name, colors: [color, color === "FFFFFF" ? "9FD3FF" : "FFFFFF"], angle, alpha, from, to };
}
/** Restyles the sheet's title block (rows 1–2 written by titleBlock) into a gradient header with a soft rule. */
function premiumTitle(ws: ExcelJS.Worksheet, span: number) {
  band(ws, 1, span, GRAD.header);
  ws.getRow(1).height = 34;
  ws.getRow(1).font = { bold: true, size: 17, color: { argb: XL.white } };
  for (let c = 1; c <= span; c++) {
    const cell = ws.getCell(2, c);
    cell.fill = gradient(["FFEAF1FA", "FFFFFFFF"], 90);
    cell.border = { ...cell.border, bottom: { style: "medium", color: { argb: "FF2F80ED" } } };
  }
  ws.getRow(2).font = { italic: true, size: 10, color: { argb: XL.navy } };
  ws.getRow(2).height = 20;
}
/** A gradient section heading with an accent rule. */
function premiumSection(ws: ExcelJS.Worksheet, text: string, span: number, colors: readonly string[] = GRAD.band): ExcelJS.Row {
  const r = sectionRow(ws, text, span, colors[0]);
  band(ws, r.number, span, colors);
  r.height = 24;
  r.getCell(1).alignment = { vertical: "middle", indent: 1 };
  r.font = { bold: true, size: 12, color: { argb: XL.white } };
  return r;
}

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
  const span = Math.min(spec.cols.length, 10);
  titleBlock(ws, spec.title, opts.subtitle, span);
  premiumTitle(ws, span);
  opts.before?.(ws);
  const headerRowNo = Math.max(opts.firstRow ?? ws.rowCount + 1, ws.rowCount + 1);
  while (ws.rowCount < headerRowNo - 1) ws.addRow([]);
  const rows = data.length ? data : [spec.cols.map(() => null)];
  ws.addTable({
    name: spec.table,
    ref: `A${headerRowNo}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
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
  const g = (Object.entries(TILE).find(([, v]) => v === fill)?.[0] ?? "navy") as keyof typeof GRAD;
  for (let r = row; r <= row + 2; r++) for (let c = col; c <= end; c++) ws.getCell(r, c).fill = gradient(GRAD[g] ?? [fill, fill], 90);
  raised(ws, row, col, row + 2, end);
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
  ws.getRow(row).height = 16;
  ws.getRow(row + 1).height = 32;
  ws.getRow(row + 2).height = 16;
}

function loginSheet(wb: ExcelJS.Workbook, names: Names, seed: Seed, shapes: XlsxShape[]) {
  const ws = sheet(wb, "Login");
  ws.views = [{ showGridLines: false, zoomScale: 110 }];
  const widths = [4, 38, 3, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const COLS = widths.length;
  const ROWS = 42;
  // a smooth colour ramp, navy at the top to teal at the bottom, with a warm glow towards the right
  const mix = (a: string, b: string, t: number) => {
    const ch = (o: number) => Math.round(parseInt(a.slice(o, o + 2), 16) * (1 - t) + parseInt(b.slice(o, o + 2), 16) * t).toString(16).padStart(2, "0");
    return `${ch(0)}${ch(2)}${ch(4)}`.toUpperCase();
  };
  // (a cell gradient repeats in every cell, so only a top-to-bottom ramp row by row reads as one smooth sweep)
  const ramp = (r: number) => `FF${mix("0F2B4C", "12A090", Math.min(1, Math.max(0, (r - 1) / (ROWS - 1))))}`;
  for (let r = 1; r <= ROWS; r++) for (let c = 1; c <= COLS; c++) ws.getCell(r, c).fill = gradient([ramp(r), ramp(r + 1)], 90);
  ws.getRow(1).height = 10;
  // the wordmark and welcome text on the right
  const D = 4;
  const say = (row: number, text: ExcelJS.CellValue, font: Partial<ExcelJS.Font>, span = 10, height?: number) => {
    const cell = ws.getCell(row, D);
    cell.value = text;
    cell.font = { name: "Calibri", ...font };
    cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
    ws.mergeCells(row, D, row, D + span);
    if (height) ws.getRow(row).height = height;
  };
  say(3, APP_NAME.toUpperCase(), { size: 10, bold: true, color: { argb: "FF9FD3FF" } });
  say(4, "Commercial", { size: 34, bold: true, color: { argb: XL.white } }, 10, 44);
  say(5, "Dashboard", { size: 34, bold: true, color: { argb: "FFFFD166" } }, 10, 44);
  say(6, "Excel edition · the whole commercial control of the programme in one workbook", { size: 11, italic: true, color: { argb: "FFDCE6F2" } });
  say(8, `${seed.programme.code} · ${seed.programme.name}${seed.asset.code ? `\n${seed.asset.code} · ${seed.asset.name}` : ""}`, { size: 11, bold: true, color: { argb: XL.white } }, 10, 34);
  const bullets = ["Sign in with the same users, roles and passwords as the website", "Level 1 · Level 2 · Movement · every register as a live Excel table", "Import the monthly report, claims tracker, bonds, payments and final accounts", "PDF report, PowerPoint presentation and the Claim EAR in Word"];
  bullets.forEach((b, i) => say(10 + i, `✦  ${b}`, { size: 10, color: { argb: "FFEAF1FA" } }, 10, 18));
  say(16, "Type your email and password in the card, then click Sign in. The password shows as blank while you type.", { size: 9, italic: true, color: { argb: "FFBFDBFE" } }, 10, 30);
  say(18, "No Sign in button? Macros are switched off: close the file, right-click it → Properties → tick Unblock, open it again and choose Enable Content.", { size: 9, italic: true, color: { argb: "FFBFDBFE" } }, 10, 30);
  say(20, "First sign-in passwords: the administrator uses Admin@123, everyone else Welcome@123. You choose your own password the first time.", { size: 9, italic: true, color: { argb: "FFBFDBFE" } }, 10, 30);
  // the sign-in card (white cells with a shadow edge)
  const cardTop = 3;
  const cardBottom = 19;
  for (let r = cardTop; r <= cardBottom; r++) ws.getCell(r, 2).fill = gradient(GRAD.card, 90);
  raised(ws, cardTop, 2, cardBottom, 2, "FF06182E", "FFFFFFFF");
  for (let r = cardTop; r <= cardBottom + 1; r++) ws.getCell(r, 3).fill = solid("FF0A2140"); // shadow column
  for (let c = 2; c <= 3; c++) ws.getCell(cardBottom + 1, c).fill = solid("FF0A2140");
  const w = (cell: string, text: ExcelJS.CellValue, font: Partial<ExcelJS.Font>, align: Partial<ExcelJS.Alignment> = {}) => {
    ws.getCell(cell).value = text;
    ws.getCell(cell).font = { name: "Calibri", ...font };
    ws.getCell(cell).alignment = { vertical: "middle", indent: 1, wrapText: true, ...align };
  };
  w("B4", "Welcome back", { size: 18, bold: true, color: { argb: XL.navy } });
  ws.getRow(4).height = 44;
  w("B5", "Sign in to open the dashboard", { size: 10, color: { argb: XL.muted } });
  ws.getRow(5).height = 44;
  w("B7", "EMAIL", { size: 8, bold: true, color: { argb: "FF2F80ED" } }, { vertical: "bottom" });
  w("B10", "PASSWORD", { size: 8, bold: true, color: { argb: "FF2F80ED" } }, { vertical: "bottom" });
  for (const cell of ["B8", "B11"]) {
    ws.getCell(cell).fill = solid("FFF3F7FC");
    ws.getCell(cell).font = { name: "Calibri", size: 12, color: { argb: XL.ink } };
    ws.getCell(cell).alignment = { vertical: "middle", indent: 1 };
    ws.getCell(cell).border = { bottom: { style: "medium", color: { argb: "FF2F80ED" } }, left: { style: "thin", color: { argb: XL.line } }, right: { style: "thin", color: { argb: XL.line } }, top: { style: "thin", color: { argb: XL.line } } };
    ws.getCell(cell).protection = { locked: false };
  }
  ws.getRow(8).height = 32;
  ws.getRow(11).height = 28;
  ws.getCell("B11").numFmt = ";;;";
  w("B13", "", { size: 9, bold: true, color: { argb: XL.redInk } });
  ws.getRow(13).height = 26;
  ws.getRow(15).height = 34;
  w("B15", "", { size: 9 });
  w("B17", "Forgotten your password? The administrator can set a new one from the Users sheet.", { size: 8, italic: true, color: { argb: XL.muted } });
  ws.getRow(17).height = 28;
  w("B19", `© ${new Date().getFullYear()} ${APP_NAME}`, { size: 8, color: { argb: XL.muted } });
  // the Sign in button and the decoration
  shapes.push(button(ws, "Sign in", "modMain.SignIn", GRAD.blue, 2, 1, 15, { icon: "➜", fontSize: 12, glow: "9FD3FF" }));
  shapes.push(
    blob("Glow 1", "ellipse", "FFFFFF", 0.1, { col: 9, row: 22 }, { col: 14, row: 40 }),
    blob("Glow 2", "ellipse", "FFD166", 0.16, { col: 4, row: 30 }, { col: 8, row: 41 }, 135),
    blob("Glow 3", "ellipse", "9FD3FF", 0.14, { col: 12, row: 0 }, { col: 14, row: 4 }),
    blob("Ring", "ellipse", "FFFFFF", 0.06, { col: 6, row: 24 }, { col: 12, row: 42 }),
  );
  for (let r = 22; r <= ROWS; r++) ws.getRow(r).height = 15;
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
  premiumTitle(ws, 5);
  ws.views = [{ showGridLines: false }];
  const put = (row: number, label: string, value: ExcelJS.CellValue, name: string, fmt?: string) => {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: true, color: { argb: XL.navy } };
    ws.getCell(row, 1).alignment = { vertical: "middle", indent: 1 };
    ws.getCell(row, 2).value = value;
    ws.getCell(row, 2).fill = gradient(GRAD.card, 90);
    ws.getCell(row, 2).alignment = { vertical: "middle", indent: 1 };
    ws.getCell(row, 2).border = { bottom: { style: "medium", color: { argb: "FF2F80ED" } }, left: { style: "thin", color: { argb: XL.line } }, right: { style: "thin", color: { argb: XL.line } }, top: { style: "thin", color: { argb: XL.line } } };
    ws.getRow(row).height = 22;
    if (fmt) ws.getCell(row, 2).numFmt = fmt;
    names.add(name, "Setup", `$B$${row}`);
  };
  premiumSection(ws, "Programme and asset", 5, GRAD.bandLight);
  put(5, "Programme code", seed.programme.code, "ProgrammeCode");
  put(6, "Programme name", seed.programme.name, "ProgrammeName");
  put(7, "Asset code", seed.asset.code, "AssetCode");
  put(8, "Asset name", seed.asset.name, "AssetName");
  put(9, "Client", seed.client, "ClientName");
  put(10, "Location", seed.location, "LocationName");
  ws.addRow([]);
  premiumSection(ws, "Current report", 5, GRAD.bandLight);
  put(13, "Current report No", seed.currentReportNo, "CurrentReportNo", "0");
  put(14, "Previous issued report No (stored copy)", { formula: `IFERROR(MAXIFS(tblSnapshots[Report No],tblSnapshots[Report No],"<"&CurrentReportNo),0)`, result: undefined }, "PrevReportNo", "0");
  put(15, "Current report label", { formula: `IFERROR(INDEX(tblPeriods[Label],MATCH(CurrentReportNo,tblPeriods[Report No],0)),"Report No "&CurrentReportNo)`, result: undefined }, "CurrentPeriodLabel");
  put(16, "Cut-off date", { formula: `IFERROR(INDEX(tblPeriods[Period end],MATCH(CurrentReportNo,tblPeriods[Report No],0)),"")`, result: undefined }, "CurrentPeriodEnd", DATE);
  put(17, "Status", { formula: `IFERROR(INDEX(tblPeriods[Status],MATCH(CurrentReportNo,tblPeriods[Report No],0)),"")`, result: undefined }, "CurrentPeriodStatus");
  ws.addRow([]);
  premiumSection(ws, "Rules", 5, GRAD.bandLight);
  put(20, "Bonds: amber when expiring within (days)", 60, "ExpiryAmberDays", "0");
  put(21, "Bonds: red when expiring within (days)", 30, "ExpiryRedDays", "0");
  put(22, "API key for the Claim EAR (Anthropic, admin only)", "", "ApiKey");
  put(23, "Claim EAR model", EAR_MODEL, "EarModel");
  ws.getCell(22, 2).numFmt = ";;;";
  ws.getCell(22, 4).value = "Type the key here; it shows as blank. The website's key works here too.";
  ws.getCell(22, 4).font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.addRow([]);
  premiumSection(ws, "Signed in (set by the workbook)", 5, GRAD.bandLight);
  put(26, "User", "", "SignedInUser");
  put(27, "Email", "", "SignedInEmail");
  put(28, "Role", "", "SignedInRole");
  const note = ws.getCell(30, 1);
  note.value = "Change the programme, asset, client and location here. The report number moves on with 'New month' or when a later monthly report is imported.";
  note.font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.mergeCells(30, 1, 30, 5);
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
  premiumTitle(ws, MOVE);
  const hdr = ws.addRow(["SAR", ...cats, "Total", "Previous report", "Movement"]);
  hdr.font = { bold: true, color: { argb: XL.white } };
  hdr.alignment = { wrapText: true, vertical: "middle" };
  hdr.height = 36;
  hdr.eachCell({ includeEmpty: true }, (c) => (c.fill = solid(XL.navy)));
  const headerRow = hdr.number;
  const rows: Record<string, number> = {};
  const cat = (ci: number) => `${colLetter(2 + ci)}$${headerRow}`;
  const sumifs = (col: string, ci: number, extra = "", table = "tblLevel2") => `SUMIFS(${table}[${col}],${table}[Category],${cat(ci)}${extra})`;
  const group = (label: string) => premiumSection(ws, label, MOVE, GRAD.bandLight);
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
  premiumTitle(ws, 7);
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
  premiumSection(ws, "Level 2 lines – previous report vs this report (rebuilt by the workbook after each import)", 7, GRAD.bandLight);
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

function homeSheet(wb: ExcelJS.Workbook, names: Names, seed: Seed, charts: XlsxChart[], shapes: XlsxShape[], l1: { rows: Record<string, number>; totalCol: number; headerRow: number; nCats: number }) {
  const ws = sheet(wb, "Home");
  ws.views = [{ showGridLines: false }];
  const COLS = 18;
  for (let c = 1; c <= COLS; c++) ws.getColumn(c).width = 10.5;
  titleBlock(ws, `Commercial Dashboard – Excel edition`, `${seed.programme.code} · ${seed.programme.name}${seed.asset.code ? ` · ${seed.asset.code} ${seed.asset.name}` : ""}`, COLS);
  premiumTitle(ws, COLS);
  ws.getRow(1).height = 40;
  ws.getRow(1).font = { bold: true, size: 20, color: { argb: XL.white } };
  ws.getCell("A3").value = { formula: `"Signed in as "&SignedInUser&" ("&SignedInRole&")  ·  "&CurrentPeriodLabel&"  ·  cut-off "&TEXT(CurrentPeriodEnd,"dd-mmm-yy")&"  ·  "&CurrentPeriodStatus`, result: undefined };
  ws.getCell("A3").font = { bold: true, color: { argb: XL.navy } };
  ws.getCell("A3").alignment = { vertical: "middle", indent: 1 };
  ws.getRow(3).height = 22;
  for (let c = 1; c <= COLS; c++) ws.getCell(3, c).fill = gradient(["FFFFFFFF", "FFEAF1FA"], 90);
  ws.mergeCells("A3:R3");
  // the buttons are shapes shipped with the workbook; the VBA wires the macros on the first sign in
  premiumSection(ws, "Actions", COLS, GRAD.bandLight);
  ws.getRow(5).height = 32;
  ws.getRow(6).height = 32;
  ws.addRow([]);
  ws.getRow(7).height = 32;
  const anchors: [string, string][] = [["ButtonsRow1", "A5"], ["ButtonsRow1b", "C5"], ["ButtonsRow1c", "E5"], ["ButtonsRow1d", "G5"], ["ButtonsRow1e", "I5"], ["ButtonsRow1f", "L5"], ["ButtonsRow2", "A6"], ["ButtonsRow2b", "D6"], ["ButtonsRow2c", "G6"], ["ButtonsRow2d", "J6"], ["ButtonsRow2e", "M6"], ["ButtonsRow2f", "P6"], ["ButtonsRow3", "A7"], ["ButtonsRow3b", "E7"]];
  for (const [n, cell] of anchors) names.add(n, "Home", `$${cell.replace(/(\d+)/, "$$$1")}`);
  for (let r = 5; r <= 7; r++) for (let c = 1; c <= COLS; c++) ws.getCell(r, c).fill = gradient(["FFF3F7FC", "FFE4ECF6"], 90);
  const btnRow1: [string, string, readonly string[], string][] = [["New month", "modPeriods.NewMonth", GRAD.blue, "◆"], ["Lock period", "modPeriods.LockCurrentPeriod", GRAD.navy, "🔒"], ["Unlock period", "modPeriods.UnlockCurrentPeriod", GRAD.teal, "🔓"], ["Recalculate", "modMain.RefreshAll", GRAD.purple, "↻"], ["Export PDF report", "modReports.ExportPdf", GRAD.orange, "▤"], ["Sign out", "modMain.SignOut", GRAD.red, "⏻"]];
  btnRow1.forEach(([n, m, g, icon], i) => shapes.push(button(ws, n, m, g, 1 + i * 3, 3, 5, { icon })));
  const btnRow2: [string, string, readonly string[], string][] = [["Import monthly report", "modImport.ImportMonthlyReport", GRAD.navy, "⬆"], ["Import claims tracker", "modImport.ImportClaimsTracker", GRAD.navy, "⬆"], ["Import bonds & insurance", "modImportGeneric.ImportBonds", GRAD.navy, "⬆"], ["Import payment tracking", "modImportGeneric.ImportPayments", GRAD.navy, "⬆"], ["Import final accounts", "modImportGeneric.ImportFinalAccounts", GRAD.navy, "⬆"], ["Change my password", "modAuth.ChangeMyPassword", GRAD.green, "✱"]];
  btnRow2.forEach(([n, m, g, icon], i) => shapes.push(button(ws, n, m, g, 1 + i * 3, 3, 6, { icon, fontSize: 9 })));
  shapes.push(button(ws, "PowerPoint presentation", "modPresentation.BuildPresentation", GRAD.gold, 1, 4, 7, { icon: "▶", glow: "FFD166" }));
  shapes.push(button(ws, "Claim EAR (Word)", "modEar.CreateClaimEar", GRAD.purple, 5, 4, 7, { icon: "✎", glow: "C9B8F5" }));
  ws.getCell(7, 10).value = "Every button asks before it changes anything; imports and exports open a file window.";
  ws.getCell(7, 10).font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.getCell(7, 10).alignment = { vertical: "middle", wrapText: true };
  ws.mergeCells(7, 10, 7, COLS);
  ws.addRow([]);
  // headline tiles
  premiumSection(ws, "Cost position (SAR) – from the Level 1 sheet", COLS, GRAD.band);
  const t1 = 10;
  tile(ws, t1, 1, 3, "Approved baseline budget", "L1_E", TILE.navy, WHOLE, "column E");
  tile(ws, t1, 4, 3, "Latest budget", "L1_G", TILE.teal, WHOLE, "E + transfers");
  tile(ws, t1, 7, 3, "Anticipated final account", "L1_N", TILE.orange, WHOLE, "column N");
  tile(ws, t1, 10, 3, "Variance to budget", "L1_O", TILE.green, WHOLE, "N − G (negative = under budget)");
  tile(ws, t1, 13, 3, "Certified to date", "L1_P", TILE.purple, WHOLE, "column P");
  tile(ws, t1, 16, 3, "Period movement", "L1_S", TILE.blue, WHOLE, "vs the previous issued report");
  while (ws.rowCount < t1 + 3) ws.addRow([]);
  ws.addRow([]);
  premiumSection(ws, "Open items – counted on the module sheets", COLS, GRAD.bandLight);
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
  premiumSection(ws, "Modules – click to open", COLS, GRAD.bandLight);
  const links = ["Setup", "Periods", "Level 1", "Level 2", "Movement", "Changes", "Claims", "Early Warnings", "Risks", "Provisional Sums", "Bonds", "Contracts", "IPCs", "Final Accounts", "Cash Flow", "Transfers", "Actions", "Users"];
  const linkRow = ws.rowCount + 1;
  const linkColors = [GRAD.blue, GRAD.teal, GRAD.purple, GRAD.green, GRAD.orange, GRAD.gold];
  links.forEach((s, i) => {
    const r = linkRow + Math.floor(i / 6);
    const c = 1 + (i % 6) * 3;
    const cell = ws.getCell(r, c);
    cell.value = { text: `▸  ${s}`, hyperlink: `#'${s}'!A1` };
    cell.font = { color: { argb: XL.navy }, bold: true, size: 10 };
    cell.alignment = { vertical: "middle", indent: 1 };
    for (let k = c; k <= c + 2; k++) {
      ws.getCell(r, k).fill = gradient(["FFFFFFFF", "FFEAF1FA"], 90);
      ws.getCell(r, k).border = { left: { style: "medium", color: { argb: linkColors[i % 6][0] } }, bottom: { style: "thin", color: { argb: XL.line } }, top: { style: "thin", color: { argb: XL.white } }, right: { style: "thin", color: { argb: XL.line } } };
    }
    ws.mergeCells(r, c, r, c + 2);
    ws.getRow(r).height = 24;
  });
  while (ws.rowCount < linkRow + Math.ceil(links.length / 6)) ws.addRow([]);
  ws.addRow([]);
  premiumSection(ws, "Charts – live Excel charts over the tables", COLS, GRAD.band);
  const chartTop = ws.rowCount; // 0-based anchor row
  const CH = 17;
  while (ws.rowCount < chartTop + CH * 2 + 2) ws.addRow([]);
  ws.addRow([]);
  // data behind the charts
  premiumSection(ws, "Data behind the charts", COLS, GRAD.bandLight);
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
  const shapes: Record<string, XlsxShape[]> = { Login: [], Home: [], Users: [] };
  const subtitle = `${seed.programme.code} · ${seed.programme.name} · loaded from the dashboard on ${new Date().toISOString().slice(0, 10)}`;

  for (const n of SHEETS_ORDER) wb.addWorksheet(n); // created up front so the tab order is fixed
  loginSheet(wb, names, seed, shapes.Login);
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
  const usersWs = tableSheet(wb, USERS, userRows, { subtitle: "Add a row for a new user (or use the buttons); passwords are stored as one-way hashes", before: (ws) => { ws.addRow([]); names.add("UsersButtons", "Users", "$A$4"); names.add("UsersButtons2", "Users", "$C$4"); ws.getRow(4).height = 32; } });
  shapes.Users.push(button(usersWs.ws, "Add user", "modAuth.AdminAddUser", GRAD.blue, 1, 1, 4, { icon: "＋" }), button(usersWs.ws, "Set a user's password", "modAuth.AdminSetPassword", GRAD.teal, 2, 2, 4, { icon: "✱" }));
  usersWs.ws.getColumn(5).hidden = true;
  tableSheet(wb, ACTIVITY, [[new Date(), "dashboard", "Workbook generated", `Loaded from ${APP_NAME}: Report No ${seed.currentReportNo}`]], { subtitle: "Newest first" });
  listsSheet(wb);
  homeSheet(wb, names, seed, charts, shapes.Home, l1);
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
  const withCharts = await addChartsToXlsx(xlsx, { Home: charts }, shapes);
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
