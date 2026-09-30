import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { AuthError } from "../auth";
import { ValidationError } from "../registers/engine";
import { logAudit } from "../audit";
import { nowIso } from "../format";
import type { UserInfo } from "../registers/types";
import { KPI_SECTIONS, type KpiDoc, type KpiSection } from "./shared";

export { KPI_SECTIONS, KPI_SECTION_LABEL, type KpiDoc, type KpiSection } from "./shared";

/**
 * The supporting documents behind each KPI entry (the DVO, the instruction, the PVO, the RFC / CRF
 * and the correspondence that dates them) and the few head-office details the dashboard does not
 * hold itself: the S/N on the Open VO Register, the file name of the pack, the root cause of a DVO
 * over 90 days and any remarks. Documents belong to the change, so they stay with it from the month
 * the VO is instructed to the month the DVO is approved.
 */

export const KPI_MAX_FILE_BYTES = 80 * 1024 * 1024;

export interface KpiItemDetails {
  change_id: number;
  sn: string;
  file_name: string;
  root_cause: string;
  remarks: string;
  updated_at: string;
  updated_by: string;
}

export function kpiDataDir(): string {
  const base = process.env.DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), "data"));
  const dir = path.join(base, "kpi");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureKpiTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_id INTEGER NOT NULL,
      section TEXT NOT NULL DEFAULT 'Correspondence',
      name TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      disk_path TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      mime TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT, created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_docs ON kpi_docs(change_id);
    CREATE TABLE IF NOT EXISTS kpi_items (
      change_id INTEGER PRIMARY KEY,
      sn TEXT DEFAULT '',
      file_name TEXT DEFAULT '',
      root_cause TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      updated_at TEXT, updated_by TEXT
    );
  `);
}

function db() {
  const d = getDb();
  ensureKpiTables(d);
  return d;
}

export function canManageKpi(user: UserInfo): boolean {
  return user.role === "admin" || user.role === "editor";
}
function assertManage(user: UserInfo) {
  if (!canManageKpi(user)) throw new AuthError("Only Editors and Admins can add or change KPI documents.");
}

/** Which section a file belongs to, read from its folder and name: "A. DVO/…", "PVO 036.pdf", "RFC0161". */
export function guessSection(relPath: string): KpiSection {
  // "HOI-PVO29_VO29_DVO_in_Progress.pdf" → "HOI PVO 29 VO 29 DVO in Progress": refs read as words, and a
  // DVO still in progress is not a DVO document
  const norm = (x: string) => x.replace(/[_\-.]+/g, " ").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2").replace(/\bdvo\s+in\s+progress\b/gi, " ").replace(/\s+/g, " ").trim();
  const t = relPath.replace(/\\/g, "/");
  const folder = norm(t.includes("/") ? t.slice(0, t.lastIndexOf("/")) : "");
  const name = norm(t.slice(t.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, ""));
  const test = (x: string): KpiSection | null => {
    if (/\bdvo\b|determination/i.test(x)) return "DVO";
    if (/\bpvo\b|proposed variation|potential variation|emergency variation/i.test(x)) return "PVO";
    if (/\brfc\b|\bcrf\b|request for change|change request/i.test(x)) return "RFC";
    if (/\bvo\b|variation order|\bei\b|engineer'?s instruction|instruction/i.test(x)) return "VO";
    if (/correspond|letter|email|mail|transmittal|ack/i.test(x)) return "Correspondence";
    return null;
  };
  return test(folder) ?? test(name) ?? "Correspondence";
}

function safeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  return base || "file";
}

function assertChange(changeId: number) {
  const row = getDb().prepare("SELECT id, programme_id FROM changes WHERE id = ?").get(changeId) as { id: number; programme_id: number } | undefined;
  if (!row) throw new ValidationError("That change is not on the register any more.");
  return row;
}

export function listKpiDocs(changeIds: number[]): KpiDoc[] {
  if (!changeIds.length) return [];
  const rows = db().prepare(`SELECT * FROM kpi_docs WHERE change_id IN (${changeIds.map(() => "?").join(",")}) ORDER BY change_id, sort_order, id`).all(...changeIds) as KpiDoc[];
  return rows;
}

export function getKpiDoc(id: number): KpiDoc | null {
  return (db().prepare("SELECT * FROM kpi_docs WHERE id = ?").get(id) as KpiDoc | undefined) ?? null;
}

export function addKpiDoc(changeId: number, input: { name: string; relPath?: string; bytes: Buffer; mime?: string; section?: string }, user: UserInfo): KpiDoc {
  assertManage(user);
  assertChange(changeId);
  const d = db();
  const rel = String(input.relPath || input.name).replace(/\\/g, "/").replace(/^\/+/, "");
  const section = (KPI_SECTIONS as readonly string[]).includes(String(input.section)) ? (input.section as KpiSection) : guessSection(rel);
  // a file uploaded again under the same name replaces the earlier copy
  const prior = d.prepare("SELECT * FROM kpi_docs WHERE change_id = ? AND rel_path = ?").get(changeId, rel) as KpiDoc | undefined;
  if (prior) removeKpiDoc(prior.id, user, true);
  const dir = path.join(kpiDataDir(), String(changeId));
  fs.mkdirSync(dir, { recursive: true });
  const next = (d.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM kpi_docs WHERE change_id = ?").get(changeId) as { n: number }).n;
  const stamp = nowIso();
  const info = d.prepare("INSERT INTO kpi_docs(change_id, section, name, rel_path, disk_path, size, mime, sort_order, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)").run(changeId, section, input.name, rel, "", input.bytes.length, input.mime ?? "", next, stamp, user.name);
  const id = Number(info.lastInsertRowid);
  const disk = path.join(String(changeId), `${id}-${safeName(input.name)}`);
  fs.writeFileSync(path.join(kpiDataDir(), disk), input.bytes);
  d.prepare("UPDATE kpi_docs SET disk_path = ? WHERE id = ?").run(disk, id);
  logAudit(getDb(), { registerKey: "kpi_docs", recordId: id, action: "create", user, summary: `KPI documents: added ${rel} (${section}) to change #${changeId}` });
  return getKpiDoc(id)!;
}

export function updateKpiDoc(id: number, patch: { section?: string; sort_order?: number }, user: UserInfo): KpiDoc {
  assertManage(user);
  const cur = getKpiDoc(id);
  if (!cur) throw new ValidationError("That document is no longer here.");
  const section = patch.section !== undefined && (KPI_SECTIONS as readonly string[]).includes(patch.section) ? patch.section : cur.section;
  const order = typeof patch.sort_order === "number" && Number.isFinite(patch.sort_order) ? patch.sort_order : cur.sort_order;
  db().prepare("UPDATE kpi_docs SET section = ?, sort_order = ? WHERE id = ?").run(section, order, id);
  if (section !== cur.section) logAudit(getDb(), { registerKey: "kpi_docs", recordId: id, action: "update", user, summary: `KPI documents: ${cur.rel_path} moved to ${section}` });
  return getKpiDoc(id)!;
}

export function removeKpiDoc(id: number, user: UserInfo, quiet = false) {
  assertManage(user);
  const cur = getKpiDoc(id);
  if (!cur) return;
  db().prepare("DELETE FROM kpi_docs WHERE id = ?").run(id);
  if (cur.disk_path) fs.rmSync(path.join(kpiDataDir(), cur.disk_path), { force: true });
  if (!quiet) logAudit(getDb(), { registerKey: "kpi_docs", recordId: id, action: "delete", user, summary: `KPI documents: removed ${cur.rel_path} from change #${cur.change_id}` });
}

export function readKpiDocBytes(doc: KpiDoc): Buffer | null {
  const p = path.join(kpiDataDir(), doc.disk_path);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function listKpiItemDetails(changeIds: number[]): Map<number, KpiItemDetails> {
  if (!changeIds.length) return new Map();
  const rows = db().prepare(`SELECT * FROM kpi_items WHERE change_id IN (${changeIds.map(() => "?").join(",")})`).all(...changeIds) as KpiItemDetails[];
  return new Map(rows.map((r) => [r.change_id, r]));
}

export function saveKpiItemDetails(changeId: number, patch: { sn?: string; file_name?: string; root_cause?: string; remarks?: string }, user: UserInfo): KpiItemDetails {
  assertManage(user);
  assertChange(changeId);
  const d = db();
  const cur = (d.prepare("SELECT * FROM kpi_items WHERE change_id = ?").get(changeId) as KpiItemDetails | undefined) ?? { change_id: changeId, sn: "", file_name: "", root_cause: "", remarks: "", updated_at: "", updated_by: "" };
  const clean = (v: unknown, max: number) => (v === undefined ? undefined : String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max));
  const next = { sn: clean(patch.sn, 20) ?? cur.sn, file_name: clean(patch.file_name, 160) ?? cur.file_name, root_cause: clean(patch.root_cause, 1000) ?? cur.root_cause, remarks: clean(patch.remarks, 1000) ?? cur.remarks };
  d.prepare("INSERT INTO kpi_items(change_id, sn, file_name, root_cause, remarks, updated_at, updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(change_id) DO UPDATE SET sn = excluded.sn, file_name = excluded.file_name, root_cause = excluded.root_cause, remarks = excluded.remarks, updated_at = excluded.updated_at, updated_by = excluded.updated_by").run(changeId, next.sn, next.file_name, next.root_cause, next.remarks, nowIso(), user.name);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of ["sn", "file_name", "root_cause", "remarks"] as const) if (next[k] !== cur[k]) changes[k] = { from: cur[k], to: next[k] };
  if (Object.keys(changes).length) logAudit(getDb(), { registerKey: "kpi_items", recordId: changeId, action: "update", user, summary: `KPI entry of change #${changeId} updated (${Object.keys(changes).join(", ")})`, changes });
  return d.prepare("SELECT * FROM kpi_items WHERE change_id = ?").get(changeId) as KpiItemDetails;
}
