import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../db";
import { nowIso } from "../../format";
import { ValidationError } from "../../registers/engine";
import type { UserInfo } from "../../registers/types";

/**
 * The report workbook of each project – the last one uploaded or imported – kept as the template the
 * month's report is written back into. One file per project, replaced by every newer upload.
 */

const base = () => process.env.DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), "data"));
const dir = () => path.join(base(), "report-templates");

function ensure() {
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS report_templates (programme_id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, uploaded_at TEXT, uploaded_by TEXT)");
  return db;
}

export interface ReportTemplate {
  programme_id: number;
  name: string;
  path: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string;
}

export function getReportTemplate(programmeId: number): ReportTemplate | null {
  const row = ensure().prepare("SELECT * FROM report_templates WHERE programme_id = ?").get(programmeId) as ReportTemplate | undefined;
  if (!row || !fs.existsSync(row.path)) return null;
  return row;
}

export function readReportTemplate(programmeId: number): { name: string; bytes: Buffer } | null {
  const t = getReportTemplate(programmeId);
  return t ? { name: t.name, bytes: fs.readFileSync(t.path) } : null;
}

export function saveReportTemplate(programmeId: number, name: string, bytes: Buffer, user: UserInfo): ReportTemplate {
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") throw new ValidationError("The template must be an Excel workbook (.xlsx / .xlsm).");
  const db = ensure();
  fs.mkdirSync(dir(), { recursive: true });
  const ext = name.match(/\.(xlsx|xlsm)$/i)?.[1].toLowerCase() ?? "xlsx";
  const p = path.join(dir(), `programme-${programmeId}.${ext}`);
  for (const other of ["xlsx", "xlsm"]) if (other !== ext) fs.rmSync(path.join(dir(), `programme-${programmeId}.${other}`), { force: true });
  fs.writeFileSync(p, bytes);
  db.prepare("INSERT INTO report_templates(programme_id, name, path, size, uploaded_at, uploaded_by) VALUES(?,?,?,?,?,?) ON CONFLICT(programme_id) DO UPDATE SET name = excluded.name, path = excluded.path, size = excluded.size, uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by").run(programmeId, name.slice(0, 200), p, bytes.length, nowIso(), user.name);
  return getReportTemplate(programmeId)!;
}
