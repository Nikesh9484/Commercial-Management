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
import { formatPages, keyPagesFor, readPdfPages } from "./pages";

export { KPI_SECTIONS, KPI_SECTION_LABEL, KPI_SECTION_HINT, kpiSectionsFor, type KpiDoc, type KpiSection } from "./shared";

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
      page_count INTEGER DEFAULT 0,
      pages TEXT DEFAULT '',
      page_kinds TEXT DEFAULT '[]',
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

let upgraded = false;
function db() {
  const d = getDb();
  ensureKpiTables(d);
  if (!upgraded) {
    upgradeKpiTables(d);
    upgraded = true;
  }
  return d;
}

// columns added after the first release
function upgradeKpiTables(d: Database.Database) {
  const cols = new Set((d.prepare("PRAGMA table_info(kpi_docs)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("page_count")) d.exec("ALTER TABLE kpi_docs ADD COLUMN page_count INTEGER DEFAULT 0");
  if (!cols.has("pages")) d.exec("ALTER TABLE kpi_docs ADD COLUMN pages TEXT DEFAULT ''");
  if (!cols.has("page_kinds")) d.exec("ALTER TABLE kpi_docs ADD COLUMN page_kinds TEXT DEFAULT '[]'");
  // the first release filed documents under DVO / VO / PVO / RFC / Correspondence
  d.exec("UPDATE kpi_docs SET section = CASE section WHEN 'DVO' THEN 'dvo_front' WHEN 'PVO' THEN 'pvo_vo_front' WHEN 'VO' THEN 'vo_issued' WHEN 'RFC' THEN 'pvo_vo_approval' WHEN 'Correspondence' THEN 'vo_issued' ELSE section END WHERE section IN ('DVO','PVO','VO','RFC','Correspondence')");
}

/** Admin, editor and the reports user all prepare the KPI packs; only a viewer just looks. */
export function canManageKpi(user: UserInfo): boolean {
  return user.role !== "viewer";
}
function assertManage(user: UserInfo) {
  if (!canManageKpi(user)) throw new AuthError("A viewer account cannot add or change KPI documents.");
}

/** Which part of the pack a file belongs to, read from its folder and name: "1. DVO approval/…", "WTRAN … DVO", "PVO 036", "LTR-0040 VO". */
export function guessSection(relPath: string): KpiSection {
  // "HOI-PVO29_VO29_DVO_in_Progress.pdf" → "HOI PVO 29 VO 29 DVO in Progress": refs read as words, and a
  // DVO still in progress is not a DVO document
  const norm = (x: string) => x.replace(/[_\-.]+/g, " ").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2").replace(/\bdvo\s+in\s+progress\b/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const t = relPath.replace(/\\/g, "/");
  const folder = norm(t.includes("/") ? t.slice(0, t.lastIndexOf("/")) : "");
  const name = norm(t.slice(t.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, ""));
  const test = (x: string): KpiSection | null => {
    if (!x) return null;
    const dvo = /\bdvo\b|determination/.test(x);
    const approval = /wtran|transmittal|workflow|approval|approved|\bwf\b/.test(x);
    const issued = /\bltr\b|letter|issued|\back\b|acknowledg|mail|correspond|transmit(?!tal)/.test(x);
    if (/^\s*1\b/.test(x) && dvo) return "dvo_approval";
    if (/^\s*2\b/.test(x) && dvo) return "dvo_front";
    if (/^\s*3\b/.test(x)) return "pvo_vo_approval";
    if (/^\s*4\b/.test(x)) return "pvo_vo_front";
    if (/^\s*5\b/.test(x)) return "vo_issued";
    if (dvo) return approval ? "dvo_approval" : "dvo_front";
    if (issued && !/\bpvo\b/.test(x)) return "vo_issued";
    if (approval) return "pvo_vo_approval";
    if (/\bpvo\b|\bvo\b|variation|\bei\b|instruction|\brfc\b|\bcrf\b|evo/.test(x)) return "pvo_vo_front";
    return null;
  };
  return test(folder) ?? test(name) ?? "pvo_vo_front";
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

export async function addKpiDoc(changeId: number, input: { name: string; relPath?: string; bytes: Buffer; mime?: string; section?: string }, user: UserInfo): Promise<KpiDoc> {
  assertManage(user);
  assertChange(changeId);
  const d = db();
  const rel = String(input.relPath || input.name).replace(/\\/g, "/").replace(/^\/+/, "");
  const section = (KPI_SECTIONS as readonly string[]).includes(String(input.section)) ? (input.section as KpiSection) : guessSection(rel);
  // a PDF is read page by page so the pack can take the pages this part wants
  const read = /\.pdf$/i.test(input.name) ? await readPdfPages(input.bytes) : null;
  const pageCount = read?.count ?? 0;
  const pages = read ? formatPages(keyPagesFor(section, read.kinds)) : "";
  const pageKinds = JSON.stringify(read?.kinds ?? []);
  // a file uploaded again under the same name replaces the earlier copy
  const prior = d.prepare("SELECT * FROM kpi_docs WHERE change_id = ? AND rel_path = ?").get(changeId, rel) as KpiDoc | undefined;
  if (prior) removeKpiDoc(prior.id, user, true);
  const dir = path.join(kpiDataDir(), String(changeId));
  fs.mkdirSync(dir, { recursive: true });
  const next = (d.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM kpi_docs WHERE change_id = ?").get(changeId) as { n: number }).n;
  const stamp = nowIso();
  const info = d.prepare("INSERT INTO kpi_docs(change_id, section, name, rel_path, disk_path, size, mime, sort_order, page_count, pages, page_kinds, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(changeId, section, input.name, rel, "", input.bytes.length, input.mime ?? "", next, pageCount, pages, pageKinds, stamp, user.name);
  const id = Number(info.lastInsertRowid);
  const disk = path.join(String(changeId), `${id}-${safeName(input.name)}`);
  fs.writeFileSync(path.join(kpiDataDir(), disk), input.bytes);
  d.prepare("UPDATE kpi_docs SET disk_path = ? WHERE id = ?").run(disk, id);
  logAudit(getDb(), { registerKey: "kpi_docs", recordId: id, action: "create", user, summary: `KPI documents: added ${rel} (${section}${pageCount ? `, pages ${pages || "all"} of ${pageCount}` : ""}) to change #${changeId}` });
  return getKpiDoc(id)!;
}

export function updateKpiDoc(id: number, patch: { section?: string; sort_order?: number; pages?: string }, user: UserInfo): KpiDoc {
  assertManage(user);
  const cur = getKpiDoc(id);
  if (!cur) throw new ValidationError("That document is no longer here.");
  const section = patch.section !== undefined && (KPI_SECTIONS as readonly string[]).includes(patch.section) ? patch.section : cur.section;
  const order = typeof patch.sort_order === "number" && Number.isFinite(patch.sort_order) ? patch.sort_order : cur.sort_order;
  let pages = patch.pages !== undefined ? String(patch.pages).replace(/[^0-9,\-–\s]|all/gi, (m) => (m.toLowerCase() === "all" ? "" : "")).trim().slice(0, 200) : cur.pages;
  if (patch.pages === undefined && section !== cur.section && cur.page_count > 0) {
    // moved to another part of the pack: that part wants different pages of the same file
    try {
      pages = formatPages(keyPagesFor(section, JSON.parse(cur.page_kinds || "[]")));
    } catch {
      /* keep the pages as they were */
    }
  }
  db().prepare("UPDATE kpi_docs SET section = ?, sort_order = ?, pages = ? WHERE id = ?").run(section, order, pages, id);
  if (section !== cur.section) logAudit(getDb(), { registerKey: "kpi_docs", recordId: id, action: "update", user, summary: `KPI documents: ${cur.rel_path} moved to ${section}` });
  if (pages !== cur.pages) logAudit(getDb(), { registerKey: "kpi_docs", recordId: id, action: "update", user, summary: `KPI documents: ${cur.rel_path} now takes pages ${pages || "all"}` });
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
