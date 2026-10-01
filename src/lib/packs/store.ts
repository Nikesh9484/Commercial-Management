import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { AuthError } from "../auth";
import { isExcelTemplate, readExcelValues } from "./excel";
import { convertToPdf, convertible } from "./convert";
import { ValidationError } from "../registers/engine";
import { logAudit } from "../audit";
import { nowIso } from "../format";
import type { UserInfo } from "../registers/types";
import { formatPages, keyPages, readPdfPages } from "../kpi/pages";
import type { PosPage } from "./positioned";
import { PACK_STATUSES, packType, slotsFor, REFERENCE_SLOT, type PackCase, type PackDoc, type PackTemplate, type PackTypeKey, type PackValues, type TemplateInspection } from "./shared";
import { classifyDoc, packParts, positioned, readApprovedPvoForDvo, changeText, executiveSummary, readCost, readEi, readEvoForChange, readLabelled, readReferenceDvo, readReferenceEar, readReferencePvo, readReferenceRfa, readRfaForChange, readRfc, type DocKind, type Reading } from "./extract";
import { autoValues, changeLogText } from "./data";
import { draftChangeWording } from "./narrative";

export * from "./shared";

/**
 * Document Packs – what is kept for each pack being prepared: the RSG template uploaded once per
 * category, the cases (one per document) with the values typed or pulled from the registers, and
 * the supporting files uploaded into the numbered slots of the compiled PDF. Files live on disk
 * under the data folder; the database holds the rows.
 */

export const PACK_MAX_FILE_BYTES = 80 * 1024 * 1024;
export const TEMPLATE_MAX_BYTES = 80 * 1024 * 1024;

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
      extra_slots INTEGER DEFAULT 0,
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

let upgraded = false;
function db() {
  const d = getDb();
  ensurePackTables(d);
  if (!upgraded) {
    const cols = new Set((d.prepare("PRAGMA table_info(pack_cases)").all() as { name: string }[]).map((c) => c.name));
    if (!cols.has("extra_slots")) d.exec("ALTER TABLE pack_cases ADD COLUMN extra_slots INTEGER DEFAULT 0");
    upgraded = true;
  }
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

/** the values typed in on the pack, kept over every re-read of the files */
export function manualValues(values: PackValues): Record<string, string> {
  try {
    const m = JSON.parse(values.__manual || "{}");
    return m && typeof m === "object" ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function sourcesOf(values: PackValues): Record<string, string> {
  try {
    return JSON.parse(values.__sources || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function updateCase(id: number, patch: { ref?: string; title?: string; revision?: string; status?: string; file_name?: string; values?: PackValues; clear?: string[] }, user: UserInfo): PackCase {
  assertManage(user);
  const cur = getCase(id);
  if (!cur) throw new ValidationError("That pack is no longer here.");
  const t = packType(cur.pack_type)!;
  const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
  const values = { ...caseValues(cur) };
  const manual = manualValues(values);
  if (patch.values && typeof patch.values === "object") {
    const known = new Set(t.fields.map((f) => f.key));
    for (const [k, v] of Object.entries(patch.values)) {
      if (!known.has(k)) continue;
      const f = t.fields.find((x) => x.key === k)!;
      // a value typed in stays as typed, whatever the files say, until it is cleared
      values[k] = manual[k] = String(v ?? "").slice(0, f.kind === "long" ? 20000 : 500);
    }
  }
  if (patch.clear?.length) for (const k of patch.clear) delete manual[k];
  values.__manual = JSON.stringify(manual);
  const sources = sourcesOf(values);
  for (const k of Object.keys(manual)) sources[k] = "entered manually";
  values.__sources = JSON.stringify(sources);
  const next = {
    ref: patch.ref !== undefined ? clean(patch.ref, 80) : cur.ref,
    title: patch.title !== undefined ? clean(patch.title, 300) : cur.title,
    revision: patch.revision !== undefined ? clean(patch.revision, 20) : cur.revision,
    status: patch.status !== undefined && (PACK_STATUSES as readonly string[]).includes(String(patch.status)) ? String(patch.status) : cur.status,
    file_name: patch.file_name !== undefined ? clean(patch.file_name, 160) : cur.file_name,
  };
  db().prepare("UPDATE pack_cases SET ref = ?, title = ?, revision = ?, status = ?, file_name = ?, values_json = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(next.ref, next.title, next.revision, next.status, next.file_name, JSON.stringify(values), nowIso(), user.name, id);
  const changed = (["ref", "title", "revision", "status", "file_name"] as const).filter((k) => next[k] !== cur[k]);
  if (patch.values || patch.clear?.length) changed.push("values" as never);
  if (changed.length) logAudit(getDb(), { registerKey: "pack_cases", recordId: id, action: "update", user, summary: `Document packs: ${t.short} ${next.ref} updated (${changed.join(", ")})` });
  return getCase(id)!;
}

/** Adds one more "Other attachment" slot to the pack. */
export function addSlot(id: number, user: UserInfo): PackCase {
  assertManage(user);
  const cur = getCase(id);
  if (!cur) throw new ValidationError("That pack is no longer here.");
  db().prepare("UPDATE pack_cases SET extra_slots = COALESCE(extra_slots, 0) + 1, updated_at = ?, updated_by = ? WHERE id = ?").run(nowIso(), user.name, id);
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

/** Which slot a file belongs to, from the folder it came in ("3. RFC/…") or the slot's own words in its name. */
export function guessSlot(type: PackTypeKey, relPath: string, extra = 0): string {
  const t = packType(type)!;
  const slots = slotsFor(t, extra);
  const norm = (x: string) => x.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const p = relPath.replace(/\\/g, "/");
  const folder = norm(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const name = norm(p.slice(p.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, ""));
  for (const x of [folder, name]) {
    if (!x) continue;
    const no = x.match(/^\s*(\d{1,2})\b/);
    if (no) {
      const sl = slots.find((s) => s.no === Number(no[1]));
      if (sl) return sl.key;
    }
    for (const sl of slots) {
      const words = sl.label.toLowerCase().replace(/[()/–\-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !/^(and|the|with|form|this|from|last|pack|other|attachment|files|folders|used|template)$/.test(w));
      if (words.some((w) => x.includes(w))) return sl.key;
    }
  }
  if (/\brfc\b|\bcrf\b|request for change/.test(name) && slots.some((s) => s.key === "rfc")) return "rfc";
  // an RFA stands as the change behind a PVO when the pack has no RFA entry of its own
  if (/\brfa\b|request for approval/.test(name) && !slots.some((s) => s.key === "details") && slots.some((s) => s.key === "rfc")) return "rfc";
  if (/\bpvo\b/.test(name) && slots.some((s) => s.key === "pvo")) return "pvo";
  if (/cost|proposal|boq|estimate|rom|price/.test(name) && slots.some((s) => s.key === "cost")) return "cost";
  if (/drawing|dwg|sketch|layout|plan/.test(name) && slots.some((s) => s.key === "drawings")) return "drawings";
  if (/approved|reference|template|previous/.test(name) && slots.some((s) => s.key === REFERENCE_SLOT)) return REFERENCE_SLOT;
  const other = slots.find((s) => s.key.startsWith("other_"));
  return other?.key ?? slots[0].key;
}

export async function addDoc(caseId: number, input: { name: string; relPath?: string; bytes: Buffer; mime?: string; slot?: string }, user: UserInfo): Promise<PackDoc & { filled: string[] }> {
  assertManage(user);
  const c = getCase(caseId);
  if (!c) throw new ValidationError("That pack is no longer here.");
  const t = packType(c.pack_type)!;
  const d = db();
  const rel = String(input.relPath || input.name).replace(/\\/g, "/").replace(/^\/+/, "");
  const slots = slotsFor(t, Number(c.extra_slots ?? 0));
  const slot = slots.some((s) => s.key === input.slot) ? String(input.slot) : guessSlot(c.pack_type, rel, Number(c.extra_slots ?? 0));
  const read = /\.pdf$/i.test(input.name) ? await readPdfPages(input.bytes) : null;
  const pageCount = read?.count ?? 0;
  // the approved PVO behind a DVO goes in as its cover pages and workflow approvals only; the reference pack is read, not compiled
  const keyOnly = slot === "pvo";
  const pages = read && keyOnly ? formatPages(keyPages(read.kinds)) : "";
  // the same file uploaded again into the same entry replaces the earlier copy (the same file in another entry is another copy)
  const prior = d.prepare("SELECT * FROM pack_docs WHERE case_id = ? AND rel_path = ? AND slot = ?").get(caseId, rel, slot) as PackDoc | undefined;
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
  // the pack is built from its files: every value is read again whenever a file arrives
  const before = caseValues(getCase(caseId)!);
  const after = await rebuildValues(caseId, user);
  const filled = Object.keys(after.values).filter((k) => !k.startsWith("__") && after.values[k] !== before[k]);
  return { ...getDoc(id)!, filled } as PackDoc & { filled: string[] };
}

/**
 * Builds the pack's values from what it has – no typing: the register item gives the base; the
 * last approved document of the same kind (the template) gives the project's particulars, the
 * contract figures, the budget lines, the wording and the signatories; the RFC gives the scope,
 * reason and basis; the cost assessment gives the value. Later sources win over earlier ones. The
 * source of every value is kept beside it, so the page can say where each one came from.
 */
export async function rebuildValues(caseId: number, user: UserInfo): Promise<{ values: PackValues; sources: Record<string, string> }> {
  const c = getCase(caseId);
  if (!c) throw new ValidationError("That pack is no longer here.");
  const t = packType(c.pack_type)!;
  const docs = listDocs(caseId);
  const base = autoValues(c.pack_type, c.programme_id, c.source_id, user);
  const values: PackValues = { ...base.values };
  // the wording drafted for the pack stays with it (it is dropped by itself once its inputs change)
  const prev = caseValues(c);
  for (const k of Object.keys(prev)) if (k.startsWith("__narrative") || k.startsWith("__wording") || k === "__manual") values[k] = prev[k];
  const sources: Record<string, string> = {};
  for (const k of Object.keys(values)) if (values[k]) sources[k] = c.source_id ? "register" : "project";
  const EXTRA = ["acc_table", "cost_subject", "cost_scope", "instruction_ref", "instruction_text", "ei_no", "change_log_rows"];
  const apply = (r: Reading, keep: string[] = []) => {
    for (const [k, v] of Object.entries(r.values)) {
      if (!v || keep.includes(k)) continue;
      if (!EXTRA.includes(k) && !t.fields.some((f) => f.key === k)) continue;
      values[k] = v;
      sources[k] = r.sources[k];
    }
  };
  // every PDF is read and recognised by its own headings; the entry it was put in only breaks a tie,
  // so a document dropped into "Other attachment" is still read and used
  const read: { doc: PackDoc; pages: PosPage[]; kind: DocKind }[] = [];
  for (const d of docs) {
    const isPdf = /\.pdf$/i.test(d.name);
    // a Word letter, a mail or a text file in a reading entry is turned into pages and read like a PDF
    if (!isPdf && !(convertible(d.name) && !isExcelTemplate(d.name))) continue;
    const bytes = readDocBytes(d);
    if (!bytes) continue;
    let pdf: Buffer | null = bytes;
    if (!isPdf) {
      try {
        pdf = (await convertToPdf(bytes, d.name))?.pdf ?? null;
      } catch {
        pdf = null;
      }
    }
    if (!pdf) continue;
    const pages = await positioned(pdf);
    if (pages.length) read.push({ doc: d, pages, kind: classifyDoc(pages, d.slot) });
  }
  const readAll = async (slot: string) => {
    // the change behind a PVO or DVO may be an RFC or an RFA – both are read for the scope and reason
    const want: DocKind[] = slot === REFERENCE_SLOT ? (t.key === "pvo" ? ["pvo"] : t.key === "dvo" ? ["dvo"] : t.key === "rfa" ? ["rfa"] : t.key === "eot_ear" || t.key === "cost_ear" ? ["ear"] : ["pvo", "dvo"]) : slot === "pvo" ? ["pvo"] : slot === "rfc" || slot === "details" ? (t.key === "rfa" ? ["rfc", "ei"] : ["rfc", "rfa", "ei"]) : slot === "cost" ? ["cost"] : [];
    // the files in the entry itself first (the entry is the user's word on what the file is), then any file elsewhere that reads as that kind;
    // the forms themselves (an RFC, an EI) come last, so what they state wins over a transmittal or a summary that quotes them
    const inSlot = read.filter((x) => x.doc.slot === slot);
    const elsewhere = read.filter((x) => x.doc.slot !== slot && want.includes(x.kind) && !(slot === "pvo" && x.doc.slot === REFERENCE_SLOT) && !(slot === REFERENCE_SLOT && x.doc.slot === "pvo"));
    const rank = (k: DocKind) => (k === "ei" || k === "rfc" || k === "rfa" ? 1 : 0);
    return [...inSlot, ...elsewhere].sort((a, b) => rank(a.kind) - rank(b.kind)).map((x) => x.pages);
  };
  // 1. the template – the last approved document of the same kind: the one uploaded on this pack,
  //    or, when there is none, the PDF set as the category's template
  //    The PDF set as the category's template (the last approved pack) is read first; a pack
  //    uploaded on this case is read after it and overrides what it carries.
  let references = (await readAll(REFERENCE_SLOT)).filter((p) => p.length);
  {
    const tpl = getTemplate(t.key);
    const bytes = tpl && /\.pdf$/i.test(tpl.name) ? readTemplateBytes(tpl) : null;
    if (bytes) {
      const pages = await positioned(bytes);
      if (pages.length) references = [pages, ...references];
    }
  }
  // the RSG workbook of the earlier document, read cell by cell: the category's Excel template first, then any workbook uploaded on the pack
  const workbooks: Reading[] = [];
  {
    const tpl = getTemplate(t.key);
    const bytes = tpl && isExcelTemplate(tpl.name) ? readTemplateBytes(tpl) : null;
    if (bytes) workbooks.push(await readExcelValues(bytes, t));
    for (const d of docs.filter((x) => isExcelTemplate(x.name))) {
      const b = readDocBytes(d);
      if (b) workbooks.push(await readExcelValues(b, t));
    }
  }
  const own = ["pvo_no", "dvo_no", "rfa_no", "date", "title", "scope", "reason", "total_value", "dvo_value", "add", "omit", "cost_items", "rfc_ref", "eac_explanation", "letter_ref", "report_ref", "claim_no", "eot_no", "emergency_circumstances", "instruction_ref", "description", "information_provided"];
  const nextNumber = (key: string, ref: Reading, label: string) => {
    if (!values[key] && ref.values[key] && /^\d+$/.test(ref.values[key])) {
      values[key] = String(Number(ref.values[key]) + 1).padStart(3, "0");
      sources[key] = label;
    }
  };
  for (const ref of workbooks) {
    if (!Object.keys(ref.values).length) continue;
    apply(ref, own);
    if (t.key === "pvo") nextNumber("pvo_no", ref, "previous PVO + 1");
    if (t.key === "vo") nextNumber("pvo_no", ref, "previous EVO + 1");
  }
  for (const pages of references) {
    if (!pages.length) continue;
    // what names the earlier document itself is not carried over: its number, its date, its title and value are this pack's own
    if (t.key === "pvo") {
      const ref = readReferencePvo(pages);
      apply(ref, own);
      // the next number after the previous PVO, unless the register already names this one
      if (!values.pvo_no && ref.values.pvo_no && /^\d+$/.test(ref.values.pvo_no)) {
        values.pvo_no = String(Number(ref.values.pvo_no) + 1).padStart(3, "0");
        sources.pvo_no = "previous PVO + 1";
      }
    } else if (t.key === "dvo") {
      const ref = readReferenceDvo(pages);
      apply(ref, [...own, "previous_dvos", "revised_contract", "vo_pct", "this_eot", "total_eot", "revised_completion", "previous_eot"]);
      // the previous determination's [b] plus its own [d] are this one's sum of previous determinations; likewise the days
      const n = (x: string | undefined) => Number(String(x ?? "").replace(/[^0-9.\-]/g, "")) || 0;
      if (ref.values.previous_dvos || ref.values.dvo_value) {
        values.previous_dvos = String(Math.round((n(ref.values.previous_dvos) + n(ref.values.dvo_value)) * 100) / 100);
        sources.previous_dvos = "previous DVO [b] + [d]";
      }
      if (ref.values.previous_eot || ref.values.this_eot) {
        values.previous_eot = String(n(ref.values.previous_eot) + n(ref.values.this_eot));
        sources.previous_eot = "previous DVO [y] + [z]";
      }
      if (!values.dvo_no && ref.values.dvo_no) {
        const m = ref.values.dvo_no.match(/^(.*?)(\d+)$/);
        if (m) {
          values.dvo_no = `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, "0")}`;
          sources.dvo_no = "previous DVO + 1";
        }
      }
    }
    else if (t.key === "rfa") apply(readReferenceRfa(pages), own);
    else if (t.key === "eot_ear" || t.key === "cost_ear") apply(readReferenceEar(pages), own);
    else {
      const ref = readReferencePvo(pages);
      apply(ref, own);
      if (t.key === "vo" && !values.pvo_no && ref.values.pvo_no && /^\d+$/.test(ref.values.pvo_no)) {
        values.pvo_no = String(Number(ref.values.pvo_no) + 1).padStart(3, "0");
        sources.pvo_no = "previous EVO + 1";
      }
    }
  }
  if (t.key === "vo" && values.pvo_no) {
    if (!values.rfc_ref) values.rfc_ref = `Emergency VO No. ${values.pvo_no}`;
    if (!values.instruction_ref) values.instruction_ref = `VO-${values.pvo_no}`;
  }

  // 2. the approved PVO behind a DVO
  if (t.key === "dvo") for (const pages of await readAll("pvo")) if (pages.length) apply(readApprovedPvoForDvo(pages));
  // 3. the RFC (or the RFA details): the change itself
  // the request behind the change may be an RFC, an RFA, an EVO or an Employer's Instruction; every written
  // page with it (an executive summary, a letter) is kept as text for the wording of the change
  const changeTexts: string[] = [];
  for (const slot of ["rfc", "details"]) {
    for (const pages of await readAll(slot)) {
      if (!pages.length) continue;
      const kind = classifyDoc(pages, "rfc");
      const isEvo = kind === "pvo" && /Emergency Variation Order Assessment/i.test(pages.slice(0, 2).flatMap((p) => p.rows.flatMap((x) => x.cells.map((c) => c.s))).join(" "));
      const text = changeText(pages);
      if (text) changeTexts.push(text);
      if (kind === "cost" || kind === "dvo" || kind === "ear" || (kind === "pvo" && !isEvo)) continue;
      apply(isEvo ? readEvoForChange(pages) : kind === "rfa" && t.key !== "rfa" ? readRfaForChange(pages) : kind === "ei" ? readEi(pages) : readRfc(pages));
    }
  }
  values.__change_texts = changeTexts.join("\n\n----\n\n").slice(0, 30000);
  // with no reason stated, the executive summary of the change pack is the reason
  if (!values.reason && t.fields.some((f) => f.key === "reason")) {
    for (const x of read.filter((d) => d.doc.slot === "rfc" || d.doc.slot === "details")) {
      const summary = executiveSummary(x.pages);
      if (summary) {
        values.reason = summary;
        sources.reason = "executive summary";
        break;
      }
    }
  }
  // 4. the cost assessment: the value – from the cost proposal entry; with nothing there, from the
  //    cost pages inside the RFC / RFA (or, for a DVO, the approved PVO pack)
  const costDocs = (await readAll("cost")).filter((p) => p.length);
  if (costDocs.length) for (const pages of costDocs) apply(readCost(pages, values.title || c.title));
  else {
    const carriers = t.key === "dvo" ? await readAll("pvo") : [...(await readAll("rfc")), ...(await readAll("details"))];
    for (const pages of carriers) {
      const part = packParts(pages);
      if (!part.cost.length) continue;
      const r = readCost(pages.filter((p) => part.cost.includes(p.no)), values.title || c.title);
      for (const k of Object.keys(r.sources)) r.sources[k] = t.key === "dvo" ? "cost in the approved PVO pack" : "cost in the RFC/RFA";
      apply(r);
      break;
    }
  }
  // the figures that follow from the others
  const num = (k: string) => Number(String(values[k] ?? "").replace(/[^0-9.\-]/g, "")) || 0;
  const r2s = (n: number) => String(Math.round(n * 100) / 100);
  if (t.key === "pvo") {
    if (!values.add && !values.omit && values.total_value) values.add = values.total_value;
    const orig = num("original_contract");
    if (orig) {
      values.current_revised = r2s(orig + num("approved_dvos"));
      values.potential_revised = r2s(orig + num("approved_dvos") + num("approved_pvos") + num("total_value"));
      sources.current_revised = sources.potential_revised = "calculated";
    }
    if (values.budget_available) {
      values.revised_budget = r2s(num("budget_available") - num("total_value"));
      values.remaining_budget = values.remaining_budget || r2s(num("approved_contract") ? num("budget_available") : 0);
      sources.revised_budget = "calculated";
    }
    if (values.pvo_no && !/^\d{3}$/.test(values.pvo_no) && /^\d+$/.test(values.pvo_no)) values.pvo_no = values.pvo_no.padStart(3, "0");
  }
  if (t.key === "dvo") {
    const a = num("contract_price");
    const e = a + num("previous_dvos") + num("interim_vos") + num("dvo_value");
    if (a) {
      values.revised_contract = r2s(e);
      values.vo_pct = `${(((e - a) / a) * 100).toFixed(2)}%`;
      sources.revised_contract = sources.vo_pct = "calculated";
    }
    values.total_eot = String(num("previous_eot") + num("this_eot"));
    if (values.pvo_value && values.dvo_value) {
      const diff = Math.round((num("pvo_value") - num("dvo_value")) * 100) / 100;
      values.movement_note = diff === 0 ? "The DVO value equals the approved PVO value." : `The DVO value is ${diff > 0 ? "lower" : "higher"} than the approved PVO value, with a variance of SAR ${Math.abs(diff).toLocaleString("en", { minimumFractionDigits: 2 })}.`;
      sources.movement_note = "calculated";
    }
    if (!values.add && values.dvo_value) values.add = values.dvo_value;
    if (!values.description && values.dvo_no) values.description = `This ${values.dvo_no} confirms the change associated with the following instruction issued:\n1. Variation Order ${values.vo_no || "No. -"}${values.instruction_ref ? ` Ref: ${values.instruction_ref}` : ""} for ${values.title || c.title}.`;
  }
  if (t.key === "vo" && !values.scope) {
    // an EVO has no RFC behind it: the scope is what the ROM prices, as its subject and scope lines name it
    const scope = [values.cost_scope, values.cost_subject].filter((x) => x && x !== values.title && !/rough order of magnitude|^rom\b|cost proposal|quotation|price proposal/i.test(x)).join("\n");
    if (scope) {
      values.scope = scope;
      sources.scope = "cost assessment";
    }
  }
  // the title: from the change itself, else the cost letter's scope or subject line
  if (!values.title) {
    const fallback = values.cost_scope || values.cost_subject || "";
    if (fallback) {
      values.title = fallback;
      sources.title = sources.cost_scope || sources.cost_subject || "cost assessment";
    }
  }
  // the next numbers follow the change log of the earlier pack: one more than the highest PVO / VO / DVO in it
  try {
    const log = JSON.parse(values.change_log_rows || "[]") as { pvo: string; vo: string; dvo: string }[];
    const maxOf = (key: "pvo" | "vo" | "dvo") => {
      let best = -1;
      let width = 2;
      for (const row of log) {
        const m = String(row[key] ?? "").match(/(\d+)\s*$/);
        if (m && Number(m[1]) > best) {
          best = Number(m[1]);
          width = m[1].length;
        }
      }
      return best < 0 ? null : { next: best + 1, width };
    };
    if ((t.key === "pvo" || t.key === "vo") && (!values.pvo_no || sources.pvo_no === "previous PVO + 1" || sources.pvo_no === "previous EVO + 1")) {
      const n = maxOf("pvo");
      if (n && (!values.pvo_no || n.next > Number(values.pvo_no))) {
        values.pvo_no = String(n.next).padStart(3, "0");
        sources.pvo_no = "change log + 1";
      }
    }
    if (t.key === "dvo" && (!values.dvo_no || sources.dvo_no === "previous DVO + 1")) {
      // the higher of: one more than the earlier DVO, one more than the highest DVO in the log
      const n = maxOf("dvo");
      const cur = Number(String(values.dvo_no ?? "").match(/(\d+)\s*$/)?.[1] ?? 0);
      if (n && n.next > cur) {
        const prefix = (log.find((r) => /\d/.test(r.dvo))?.dvo ?? "DVO-").replace(/\d+\s*$/, "") || "DVO-";
        values.dvo_no = `${prefix}${String(n.next).padStart(n.width, "0")}`;
        sources.dvo_no = "change log + 1";
      }
    }
  } catch {
    /* no usable log */
  }
  // anything still missing: a labelled line in a file put in as an additional attachment ("Contract name: …")
  for (const x of read.filter((d) => d.doc.slot.startsWith("other_"))) {
    const extra = readLabelled(x.pages, t);
    for (const [k, v] of Object.entries(extra.values)) {
      if (values[k] || !v) continue;
      values[k] = v;
      sources[k] = `attachment ${x.doc.name}`.slice(0, 60);
    }
  }
  // the change log of the earlier pack, as text for the page
  try {
    const rows = JSON.parse(values.change_log_rows || "[]") as Parameters<typeof changeLogText>[0];
    if (rows.length) {
      values.change_log = changeLogText(rows);
      sources.change_log = sources.change_log_rows ?? "previous pack";
    }
  } catch {
    /* no log */
  }
  // the change worded from its documents, when the AI is on
  if (t.key === "pvo" || t.key === "vo") {
    const drafted = await draftChangeWording(values, values.__change_texts ?? "");
    if (drafted) {
      for (const k of ["title", "scope", "reason", "contractual_basis"] as const) {
        if (drafted[k]?.trim() && (k !== "contractual_basis" || !values[k])) {
          values[k] = drafted[k].trim();
          sources[k] = "worded from the change documents";
        }
      }
    }
  }
  // what was typed in on the pack stays as typed
  const manual = manualValues(values);
  for (const [k, v] of Object.entries(manual)) {
    values[k] = v;
    sources[k] = "entered manually";
  }
  values.__sources = JSON.stringify(sources);
  const ref = t.key === "pvo" ? values.pvo_no || c.ref : t.key === "dvo" ? values.dvo_no || c.ref : t.key === "rfa" ? values.rfa_no || c.ref : c.ref;
  const generic = !c.title || c.title === t.label || c.title === t.short;
  const title = values.title || (generic ? "" : c.title) || c.title;
  db().prepare("UPDATE pack_cases SET values_json = ?, ref = ?, title = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(JSON.stringify(values), String(ref ?? "").slice(0, 80), String(title ?? "").slice(0, 300), nowIso(), user.name, caseId);
  return { values, sources };
}

export function updateDoc(id: number, patch: { slot?: string; sort_order?: number; pages?: string }, user: UserInfo): PackDoc {
  assertManage(user);
  const cur = getDoc(id);
  if (!cur) throw new ValidationError("That document is no longer here.");
  const c = getCase(cur.case_id);
  const t = c ? packType(c.pack_type) : null;
  const slot = patch.slot !== undefined && t && slotsFor(t, Number(c?.extra_slots ?? 0)).some((s) => s.key === patch.slot) ? String(patch.slot) : cur.slot;
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

/** Reads a pack's values from its remaining files after a document is removed. */
export async function removeDocAndRebuild(id: number, user: UserInfo) {
  const cur = getDoc(id);
  removeDoc(id, user);
  if (cur) await rebuildValues(cur.case_id, user);
}

export function readDocBytes(doc: PackDoc): Buffer | null {
  const p = path.join(packDataDir(), doc.disk_path);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
