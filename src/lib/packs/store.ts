import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { AuthError } from "../auth";
import { ValidationError } from "../registers/engine";
import { logAudit } from "../audit";
import { nowIso } from "../format";
import type { UserInfo } from "../registers/types";
import { formatPages, keyPages, readPdfPages } from "../kpi/pages";
import { PACK_STATUSES, packType, type PackCase, type PackDoc, type PackTemplate, type PackTypeKey, type PackValues, type TemplateInspection } from "./shared";

export * from "./shared";

/**
 * Document Packs – what is kept for each pack being prepared: the RSG template uploaded once per
 * category, the cases (one per document) with the values typed or pulled from the registers, and
 * the supporting files uploaded into the numbered slots of the compiled PDF. Files live on disk
 * under the data folder; the database holds the rows.
 */

export const PACK_MAX_FILE_BYTES = 80 * 1024 * 1024;
export const TEMPLATE_MAX_BYTES = 25 * 1024 * 1024;

export function packDataDir(): string {
  const base = process.env.DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), "data"));
  const dir = path.join(base, "packs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensurePackTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pack_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_type TEXT NOT NULL,
      name TEXT NOT NULL,
      disk_path TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      mime TEXT DEFAULT '',
      fields_json TEXT DEFAULT '{}',
      created_at TEXT, created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS pack_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_type TEXT NOT NULL,
      programme_id INTEGER NOT NULL,
      source_table TEXT NOT NULL DEFAULT 'changes',
      source_id INTEGER,
      ref TEXT DEFAULT '',
      title TEXT DEFAULT '',
      revision TEXT DEFAULT '',
      status TEXT DEFAULT 'Draft',
      values_json TEXT DEFAULT '{}',
      file_name TEXT DEFAULT '',
      created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pack_cases ON pack_cases(programme_id, pack_type);
    CREATE TABLE IF NOT EXISTS pack_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      slot TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_pack_docs ON pack_docs(case_id);
  `);
}

function db() {
  const d = getDb();
  ensurePackTables(d);
  return d;
}

/** Admin, editor and the reports user all prepare document packs; only a viewer just looks. */
export function canManagePacks(user: UserInfo): boolean {
  return user.role !== "viewer";
}
function assertManage(user: UserInfo) {
  if (!canManagePacks(user)) throw new AuthError("A viewer account cannot prepare document packs.");
}

function safeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  return base || "file";
}

/* ------------------------------------------------------------------ */
/* templates                                                           */

export function getTemplate(type: PackTypeKey): PackTemplate | null {
  return (db().prepare("SELECT * FROM pack_templates WHERE pack_type = ? ORDER BY id DESC LIMIT 1").get(type) as PackTemplate | undefined) ?? null;
}

export function listTemplates(): Map<PackTypeKey, PackTemplate> {
  const rows = db().prepare("SELECT * FROM pack_templates ORDER BY id").all() as PackTemplate[];
  const out = new Map<PackTypeKey, PackTemplate>();
  for (const r of rows) out.set(r.pack_type, r); // the latest wins
  return out;
}

export function readTemplateBytes(t: PackTemplate): Buffer | null {
  const p = path.join(packDataDir(), t.disk_path);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function saveTemplate(type: PackTypeKey, input: { name: string; bytes: Buffer; mime?: string; inspection: TemplateInspection }, user: UserInfo): PackTemplate {
  assertManage(user);
  if (!packType(type)) throw new ValidationError("Unknown pack category.");
  if (!/\.(docx|dotx|docm)$/i.test(input.name)) throw new ValidationError("The template must be a Word file (.docx). Save the RSG form as .docx and upload it again.");
  const d = db();
  const prior = d.prepare("SELECT * FROM pack_templates WHERE pack_type = ?").all(type) as PackTemplate[];
  const stamp = nowIso();
  const info = d.prepare("INSERT INTO pack_templates(pack_type, name, disk_path, size, mime, fields_json, created_at, created_by) VALUES(?,?,?,?,?,?,?,?)").run(type, input.name, "", input.bytes.length, input.mime ?? "", JSON.stringify(input.inspection), stamp, user.name);
  const id = Number(info.lastInsertRowid);
  const dir = path.join(packDataDir(), "templates");
  fs.mkdirSync(dir, { recursive: true });
  const disk = path.join("templates", `${id}-${safeName(input.name)}`);
  fs.writeFileSync(path.join(packDataDir(), disk), input.bytes);
  d.prepare("UPDATE pack_templates SET disk_path = ? WHERE id = ?").run(disk, id);
  // one template per category: the earlier copies go
  for (const p of prior) {
    d.prepare("DELETE FROM pack_templates WHERE id = ?").run(p.id);
    if (p.disk_path) fs.rmSync(path.join(packDataDir(), p.disk_path), { force: true });
  }
  logAudit(getDb(), { registerKey: "pack_templates", recordId: id, action: "create", user, summary: `Document packs: ${packType(type)!.short} template set to ${input.name} (${input.inspection.placeholders.length} placeholders, ${input.inspection.labels.filter((l) => l.field).length} labels matched)` });
  return d.prepare("SELECT * FROM pack_templates WHERE id = ?").get(id) as PackTemplate;
}

export function removeTemplate(id: number, user: UserInfo) {
  assertManage(user);
  const d = db();
  const t = d.prepare("SELECT * FROM pack_templates WHERE id = ?").get(id) as PackTemplate | undefined;
  if (!t) return;
  d.prepare("DELETE FROM pack_templates WHERE id = ?").run(id);
  if (t.disk_path) fs.rmSync(path.join(packDataDir(), t.disk_path), { force: true });
  logAudit(getDb(), { registerKey: "pack_templates", recordId: id, action: "delete", user, summary: `Document packs: ${t.pack_type} template ${t.name} removed – the built-in layout is used until a new one is uploaded` });
}

/* ------------------------------------------------------------------ */
/* cases                                                               */

export function listCases(programmeId: number, type: PackTypeKey): PackCase[] {
  return db().prepare("SELECT * FROM pack_cases WHERE programme_id = ? AND pack_type = ? ORDER BY updated_at DESC, id DESC").all(programmeId, type) as PackCase[];
}

export function countCases(programmeId: number): Map<PackTypeKey, number> {
  const rows = db().prepare("SELECT pack_type, COUNT(*) AS n FROM pack_cases WHERE programme_id = ? GROUP BY pack_type").all(programmeId) as { pack_type: PackTypeKey; n: number }[];
  return new Map(rows.map((r) => [r.pack_type, r.n]));
}

export function getCase(id: number): PackCase | null {
  return (db().prepare("SELECT * FROM pack_cases WHERE id = ?").get(id) as PackCase | undefined) ?? null;
}

export function caseValues(c: PackCase): PackValues {
  try {
    const v = JSON.parse(c.values_json || "{}");
    return v && typeof v === "object" ? (v as PackValues) : {};
  } catch {
    return {};
  }
}

export function createCase(input: { type: PackTypeKey; programmeId: number; sourceId: number | null; ref: string; title: string; values: PackValues }, user: UserInfo): PackCase {
  assertManage(user);
  const t = packType(input.type);
  if (!t) throw new ValidationError("Unknown pack category.");
  const stamp = nowIso();
  const info = db()
    .prepare("INSERT INTO pack_cases(pack_type, programme_id, source_table, source_id, ref, title, revision, status, values_json, file_name, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(input.type, input.programmeId, t.source, input.sourceId, input.ref.slice(0, 80), input.title.slice(0, 300), "", "Draft", JSON.stringify(input.values), "", stamp, user.name, stamp, user.name);
  const id = Number(info.lastInsertRowid);
  logAudit(getDb(), { registerKey: "pack_cases", recordId: id, action: "create", user, summary: `Document packs: ${t.short} ${input.ref || ""} – ${input.title} started` });
  return getCase(id)!;
}

export function updateCase(id: number, patch: { ref?: string; title?: string; revision?: string; status?: string; file_name?: string; values?: PackValues }, user: UserInfo): PackCase {
  assertManage(user);
  const cur = getCase(id);
  if (!cur) throw new ValidationError("That pack is no longer here.");
  const t = packType(cur.pack_type)!;
  const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
  const values = { ...caseValues(cur) };
  if (patch.values && typeof patch.values === "object") {
    const known = new Set(t.fields.map((f) => f.key));
    for (const [k, v] of Object.entries(patch.values)) {
      if (!known.has(k)) continue;
      const f = t.fields.find((x) => x.key === k)!;
      values[k] = String(v ?? "").slice(0, f.kind === "long" ? 20000 : 500);
    }
  }
  const next = {
    ref: patch.ref !== undefined ? clean(patch.ref, 80) : cur.ref,
    title: patch.title !== undefined ? clean(patch.title, 300) : cur.title,
    revision: patch.revision !== undefined ? clean(patch.revision, 20) : cur.revision,
    status: patch.status !== undefined && (PACK_STATUSES as readonly string[]).includes(String(patch.status)) ? String(patch.status) : cur.status,
    file_name: patch.file_name !== undefined ? clean(patch.file_name, 160) : cur.file_name,
  };
  db().prepare("UPDATE pack_cases SET ref = ?, title = ?, revision = ?, status = ?, file_name = ?, values_json = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(next.ref, next.title, next.revision, next.status, next.file_name, JSON.stringify(values), nowIso(), user.name, id);
  const changed = (["ref", "title", "revision", "status", "file_name"] as const).filter((k) => next[k] !== cur[k]);
  if (patch.values) changed.push("values" as never);
  if (changed.length) logAudit(getDb(), { registerKey: "pack_cases", recordId: id, action: "update", user, summary: `Document packs: ${t.short} ${next.ref} updated (${changed.join(", ")})` });
  return getCase(id)!;
}

export function removeCase(id: number, user: UserInfo) {
  assertManage(user);
  const cur = getCase(id);
  if (!cur) return;
  const d = db();
  for (const doc of listDocs(id)) removeDoc(doc.id, user, true);
  d.prepare("DELETE FROM pack_cases WHERE id = ?").run(id);
  fs.rmSync(path.join(packDataDir(), String(id)), { recursive: true, force: true });
  logAudit(getDb(), { registerKey: "pack_cases", recordId: id, action: "delete", user, summary: `Document packs: ${cur.pack_type} ${cur.ref} – ${cur.title} removed with its files` });
}

/* ------------------------------------------------------------------ */
/* supporting documents                                                */

export function listDocs(caseId: number): PackDoc[] {
  return db().prepare("SELECT * FROM pack_docs WHERE case_id = ? ORDER BY sort_order, id").all(caseId) as PackDoc[];
}

export function countDocs(caseIds: number[]): Map<number, number> {
  if (!caseIds.length) return new Map();
  const rows = db().prepare(`SELECT case_id, COUNT(*) AS n FROM pack_docs WHERE case_id IN (${caseIds.map(() => "?").join(",")}) GROUP BY case_id`).all(...caseIds) as { case_id: number; n: number }[];
  return new Map(rows.map((r) => [r.case_id, r.n]));
}

export function getDoc(id: number): PackDoc | null {
  return (db().prepare("SELECT * FROM pack_docs WHERE id = ?").get(id) as PackDoc | undefined) ?? null;
}

/** Which slot a file belongs to, from the folder it came in ("3. Programme/…") or the slot's own words in its name. */
export function guessSlot(type: PackTypeKey, relPath: string): string {
  const t = packType(type)!;
  const norm = (x: string) => x.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const p = relPath.replace(/\\/g, "/");
  const folder = norm(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const name = norm(p.slice(p.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, ""));
  for (const x of [folder, name]) {
    if (!x) continue;
    const no = x.match(/^\s*(\d)\b/);
    if (no) {
      const s = t.slots.find((sl) => sl.no === Number(no[1]));
      if (s) return s.key;
    }
    for (const s of t.slots) {
      const words = s.label.toLowerCase().replace(/[()/–-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !/^(and|the|with|form|this|from)$/.test(w));
      if (words.some((w) => x.includes(w))) return s.key;
    }
  }
  const dvo = /\bdvo\b|determination/.test(name);
  const approval = /wtran|transmittal|workflow|approval|approved/.test(name);
  if (approval) return t.slots.find((s) => /approval/i.test(s.key))?.key ?? t.slots[t.slots.length - 1].key;
  if (dvo) return t.slots.find((s) => /vo|annex/i.test(s.key))?.key ?? t.slots[0].key;
  return t.slots[0].key;
}

export async function addDoc(caseId: number, input: { name: string; relPath?: string; bytes: Buffer; mime?: string; slot?: string }, user: UserInfo): Promise<PackDoc> {
  assertManage(user);
  const c = getCase(caseId);
  if (!c) throw new ValidationError("That pack is no longer here.");
  const t = packType(c.pack_type)!;
  const d = db();
  const rel = String(input.relPath || input.name).replace(/\\/g, "/").replace(/^\/+/, "");
  const slot = t.slots.some((s) => s.key === input.slot) ? String(input.slot) : guessSlot(c.pack_type, rel);
  const read = /\.pdf$/i.test(input.name) ? await readPdfPages(input.bytes) : null;
  const pageCount = read?.count ?? 0;
  // a compiled pack takes the key pages of Aconex approvals and forms; everything else goes in whole
  const keyOnly = /approval/.test(slot) || /\b(vo|dvo|pvo|annex)\b/.test(slot);
  const pages = read && keyOnly ? formatPages(keyPages(read.kinds)) : "";
  const prior = d.prepare("SELECT * FROM pack_docs WHERE case_id = ? AND rel_path = ?").get(caseId, rel) as PackDoc | undefined;
  if (prior) removeDoc(prior.id, user, true);
  const dir = path.join(packDataDir(), String(caseId));
  fs.mkdirSync(dir, { recursive: true });
  const next = (d.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pack_docs WHERE case_id = ?").get(caseId) as { n: number }).n;
  const info = d.prepare("INSERT INTO pack_docs(case_id, slot, name, rel_path, disk_path, size, mime, sort_order, page_count, pages, page_kinds, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(caseId, slot, input.name, rel, "", input.bytes.length, input.mime ?? "", next, pageCount, pages, JSON.stringify(read?.kinds ?? []), nowIso(), user.name);
  const id = Number(info.lastInsertRowid);
  const disk = path.join(String(caseId), `${id}-${safeName(input.name)}`);
  fs.writeFileSync(path.join(packDataDir(), disk), input.bytes);
  d.prepare("UPDATE pack_docs SET disk_path = ? WHERE id = ?").run(disk, id);
  d.prepare("UPDATE pack_cases SET updated_at = ?, updated_by = ? WHERE id = ?").run(nowIso(), user.name, caseId);
  logAudit(getDb(), { registerKey: "pack_docs", recordId: id, action: "create", user, summary: `Document packs: ${rel} added to ${t.short} ${c.ref} (${slot})` });
  return getDoc(id)!;
}

export function updateDoc(id: number, patch: { slot?: string; sort_order?: number; pages?: string }, user: UserInfo): PackDoc {
  assertManage(user);
  const cur = getDoc(id);
  if (!cur) throw new ValidationError("That document is no longer here.");
  const c = getCase(cur.case_id);
  const t = c ? packType(c.pack_type) : null;
  const slot = patch.slot !== undefined && t?.slots.some((s) => s.key === patch.slot) ? String(patch.slot) : cur.slot;
  const order = typeof patch.sort_order === "number" && Number.isFinite(patch.sort_order) ? patch.sort_order : cur.sort_order;
  const pages = patch.pages !== undefined ? String(patch.pages).replace(/all/gi, "").replace(/[^0-9,\-–\s]/g, "").trim().slice(0, 200) : cur.pages;
  db().prepare("UPDATE pack_docs SET slot = ?, sort_order = ?, pages = ? WHERE id = ?").run(slot, order, pages, id);
  if (slot !== cur.slot) logAudit(getDb(), { registerKey: "pack_docs", recordId: id, action: "update", user, summary: `Document packs: ${cur.rel_path} moved to ${slot}` });
  if (pages !== cur.pages) logAudit(getDb(), { registerKey: "pack_docs", recordId: id, action: "update", user, summary: `Document packs: ${cur.rel_path} now takes pages ${pages || "all"}` });
  return getDoc(id)!;
}

export function removeDoc(id: number, user: UserInfo, quiet = false) {
  assertManage(user);
  const cur = getDoc(id);
  if (!cur) return;
  db().prepare("DELETE FROM pack_docs WHERE id = ?").run(id);
  if (cur.disk_path) fs.rmSync(path.join(packDataDir(), cur.disk_path), { force: true });
  if (!quiet) logAudit(getDb(), { registerKey: "pack_docs", recordId: id, action: "delete", user, summary: `Document packs: ${cur.rel_path} removed from pack #${cur.case_id}` });
}

export function readDocBytes(doc: PackDoc): Buffer | null {
  const p = path.join(packDataDir(), doc.disk_path);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
