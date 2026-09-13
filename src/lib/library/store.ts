import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { nowIso } from "../format";
import { ValidationError } from "../registers/engine";
import { AuthError } from "../auth";
import { logAudit } from "../audit";
import type { UserInfo } from "../registers/types";

/**
 * Document libraries: the EOT Library (Employer's Assessment Reports and the claim documents behind
 * them) and the Contract Library (contract agreements, letters of award, conditions, amendments …).
 * Every document is kept on disk under the data folder, its readable text is extracted, and the
 * dashboard reads it to file it under the right contractor and contract code. Libraries are per
 * project (programme), like every other register.
 */
export const LIBRARIES = ["eot", "contract"] as const;
export type LibraryKey = (typeof LIBRARIES)[number];

export const LIBRARY_INFO: Record<LibraryKey, { title: string; short: string; subtitle: string; types: string[]; hint: string }> = {
  eot: {
    title: "EOT Library – Employer's Assessment Reports",
    short: "EOT Library",
    subtitle: "Every Employer's Assessment Report (EAR) for extension of time and prolongation claims, filed under its contractor and contract code. Upload the PDF or Word files, or a whole folder; the dashboard reads each report and records who it is for, what it decides and when.",
    types: ["EAR – Extension of Time", "EAR – Prolongation / Cost", "EAR – Combined (Time & Cost)", "Claim submission", "Notice / correspondence", "Determination letter", "Other"],
    hint: "PDF or Word files (EAR, claim submissions, determination letters). A folder can be dropped in at once – sub-folders are kept as the document's location.",
  },
  contract: {
    title: "Contract Library – Contract documents",
    short: "Contract Library",
    subtitle: "The contract documents of every contract: agreement, letter of award, conditions, specifications, pricing schedules, amendments. Upload the PDF or Word files, or a whole folder; the dashboard reads each one and files it under its contractor and contract code.",
    types: ["Contract Agreement", "Letter of Award / Acceptance", "Conditions of Contract", "Particular Conditions", "Scope of Work / Specification", "Pricing Schedule / BoQ", "Amendment / Addendum", "Variation / Change Order", "Bond / Guarantee", "Other"],
    hint: "PDF or Word files (contract agreement, LOA, conditions, amendments). A folder can be dropped in at once – sub-folders are kept as the document's location.",
  },
};

export interface LibraryDoc {
  id: number;
  programme_id: number;
  library: LibraryKey;
  name: string;
  rel_path: string;
  disk_path: string;
  size: number;
  mime: string;
  kind: string;
  text_chars: number;
  note: string | null;
  contractor_id: number | null;
  contractor: string | null;
  contract_id: number | null;
  contract_code: string | null;
  contract_title: string | null;
  po_no: string | null;
  doc_type: string;
  title: string;
  reference: string;
  doc_date: string | null;
  claim_ref: string;
  eot_days_claimed: number | null;
  eot_days_assessed: number | null;
  cost_claimed: number | null;
  cost_assessed: number | null;
  summary: string;
  key_points: string;
  matched_by: string;
  confidence: string;
  read_status: "Read" | "Partly read" | "Unread" | "Manual";
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export const LIBRARY_MAX_FILE_BYTES = 80 * 1024 * 1024;

export function libraryDataDir(): string {
  const base = process.env.DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), "data"));
  const dir = path.join(base, "library");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureLibraryTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programme_id INTEGER NOT NULL,
      library TEXT NOT NULL,
      name TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      disk_path TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      mime TEXT DEFAULT '',
      kind TEXT DEFAULT '',
      text TEXT,
      text_chars INTEGER DEFAULT 0,
      note TEXT,
      contractor_id INTEGER,
      contract_id INTEGER,
      contract_code TEXT,
      po_no TEXT,
      doc_type TEXT DEFAULT '',
      title TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      doc_date TEXT,
      claim_ref TEXT DEFAULT '',
      eot_days_claimed REAL,
      eot_days_assessed REAL,
      cost_claimed REAL,
      cost_assessed REAL,
      summary TEXT DEFAULT '',
      key_points TEXT DEFAULT '',
      matched_by TEXT DEFAULT '',
      confidence TEXT DEFAULT '',
      read_status TEXT DEFAULT 'Unread',
      created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_library_docs ON library_docs(programme_id, library);
  `);
}

function db() {
  const d = getDb();
  ensureLibraryTables(d);
  return d;
}

export function canManageLibrary(user: UserInfo): boolean {
  return user.role === "admin" || user.role === "editor";
}
function assertManage(user: UserInfo) {
  if (!canManageLibrary(user)) throw new AuthError("Only Editors and Admins can add or change library documents.");
}
export function assertLibrary(key: string): LibraryKey {
  if (!(LIBRARIES as readonly string[]).includes(key)) throw new ValidationError("Unknown library.");
  return key as LibraryKey;
}

const COLS = `d.id, d.programme_id, d.library, d.name, d.rel_path, d.disk_path, d.size, d.mime, d.kind, d.text_chars, d.note, d.contractor_id,
  (SELECT name FROM contractors WHERE id = d.contractor_id) AS contractor, d.contract_id,
  COALESCE(d.contract_code, (SELECT acc_ref FROM contracts WHERE id = d.contract_id)) AS contract_code,
  (SELECT title FROM contracts WHERE id = d.contract_id) AS contract_title,
  COALESCE(d.po_no, (SELECT reef_po_no FROM contracts WHERE id = d.contract_id)) AS po_no,
  d.doc_type, d.title, d.reference, d.doc_date, d.claim_ref, d.eot_days_claimed, d.eot_days_assessed, d.cost_claimed, d.cost_assessed,
  d.summary, d.key_points, d.matched_by, d.confidence, d.read_status, d.created_at, d.created_by, d.updated_at, d.updated_by`;

export interface LibraryFilter {
  contractor_id?: number | null;
  contract_id?: number | null;
  doc_type?: string | null;
  q?: string | null;
}

/** The documents of one library for a project, newest first, with optional filters. */
export function listDocs(programmeId: number, library: LibraryKey, filter: LibraryFilter = {}): LibraryDoc[] {
  const where: string[] = ["d.programme_id = ?", "d.library = ?"];
  const args: unknown[] = [programmeId, library];
  if (filter.contractor_id) {
    where.push("d.contractor_id = ?");
    args.push(filter.contractor_id);
  }
  if (filter.contract_id) {
    where.push("d.contract_id = ?");
    args.push(filter.contract_id);
  }
  if (filter.doc_type) {
    where.push("d.doc_type = ?");
    args.push(filter.doc_type);
  }
  if (filter.q && filter.q.trim()) {
    const like = `%${filter.q.trim()}%`;
    where.push("(d.name LIKE ? OR d.rel_path LIKE ? OR d.title LIKE ? OR d.reference LIKE ? OR d.claim_ref LIKE ? OR d.summary LIKE ? OR d.key_points LIKE ? OR d.contract_code LIKE ? OR d.po_no LIKE ? OR d.text LIKE ?)");
    args.push(like, like, like, like, like, like, like, like, like, like);
  }
  return db().prepare(`SELECT ${COLS} FROM library_docs d WHERE ${where.join(" AND ")} ORDER BY COALESCE(d.doc_date, '') DESC, d.created_at DESC`).all(...args) as LibraryDoc[];
}

export function getDoc(id: number): LibraryDoc | null {
  return (db().prepare(`SELECT ${COLS} FROM library_docs d WHERE d.id = ?`).get(id) as LibraryDoc | undefined) ?? null;
}

export function docText(id: number): string {
  const r = db().prepare("SELECT text FROM library_docs WHERE id = ?").get(id) as { text: string | null } | undefined;
  return r?.text ?? "";
}

export function docDiskPath(doc: LibraryDoc): string {
  return path.join(libraryDataDir(), doc.disk_path);
}

/** A safe file name for disk (the original name is kept in the database). */
function safeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  return base || "file";
}

export interface Reading {
  contractor_id: number | null;
  contract_id: number | null;
  contract_code: string | null;
  po_no: string | null;
  doc_type: string;
  title: string;
  reference: string;
  doc_date: string | null;
  claim_ref: string;
  eot_days_claimed: number | null;
  eot_days_assessed: number | null;
  cost_claimed: number | null;
  cost_assessed: number | null;
  summary: string;
  key_points: string[];
  matched_by: string;
  confidence: string;
  read_status: LibraryDoc["read_status"];
}

export function addDoc(
  programmeId: number,
  library: LibraryKey,
  input: { name: string; relPath?: string; bytes: Buffer; mime?: string },
  extracted: { kind: string; text: string; note: string | null },
  reading: Reading,
  user: UserInfo,
): LibraryDoc {
  assertManage(user);
  if (input.bytes.length > LIBRARY_MAX_FILE_BYTES) throw new ValidationError(`${input.name} is larger than ${Math.round(LIBRARY_MAX_FILE_BYTES / 1024 / 1024)} MB.`);
  const d = db();
  const dir = path.join(libraryDataDir(), library, String(programmeId));
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const disk = `${id}-${safeName(input.name)}`;
  fs.writeFileSync(path.join(dir, disk), input.bytes);
  const rel = (input.relPath || input.name).replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 400);
  const stamp = nowIso();
  // the same file uploaded again (same location and name) replaces the earlier copy
  const dup = d.prepare("SELECT id FROM library_docs WHERE programme_id = ? AND library = ? AND rel_path = ?").get(programmeId, library, rel) as { id: number } | undefined;
  if (dup) removeDoc(dup.id, user, true);
  const r = d
    .prepare(
      `INSERT INTO library_docs(programme_id, library, name, rel_path, disk_path, size, mime, kind, text, text_chars, note, contractor_id, contract_id, contract_code, po_no, doc_type, title, reference, doc_date, claim_ref,
         eot_days_claimed, eot_days_assessed, cost_claimed, cost_assessed, summary, key_points, matched_by, confidence, read_status, created_at, created_by, updated_at, updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      programmeId, library, input.name, rel, path.join(library, String(programmeId), disk), input.bytes.length, input.mime ?? "", extracted.kind, extracted.text, extracted.text.length, extracted.note,
      reading.contractor_id, reading.contract_id, reading.contract_code, reading.po_no, reading.doc_type, reading.title, reading.reference, reading.doc_date, reading.claim_ref,
      reading.eot_days_claimed, reading.eot_days_assessed, reading.cost_claimed, reading.cost_assessed, reading.summary, JSON.stringify(reading.key_points ?? []), reading.matched_by, reading.confidence, reading.read_status,
      stamp, user.name, stamp, user.name,
    );
  const row = getDoc(Number(r.lastInsertRowid))!;
  logAudit(getDb(), { registerKey: `library_${library}`, recordId: row.id, action: "create", user, summary: `${LIBRARY_INFO[library].short}: added ${rel}${row.contractor ? ` (${row.contractor}${row.contract_code ? ` · ${row.contract_code}` : ""})` : ""}` });
  return row;
}

/** Re-applies a fresh reading (after the engine re-read the document). */
export function applyReading(id: number, reading: Reading, user: UserInfo): LibraryDoc {
  assertManage(user);
  db()
    .prepare(
      `UPDATE library_docs SET contractor_id=?, contract_id=?, contract_code=?, po_no=?, doc_type=?, title=?, reference=?, doc_date=?, claim_ref=?, eot_days_claimed=?, eot_days_assessed=?, cost_claimed=?, cost_assessed=?, summary=?, key_points=?, matched_by=?, confidence=?, read_status=?, updated_at=?, updated_by=? WHERE id=?`,
    )
    .run(reading.contractor_id, reading.contract_id, reading.contract_code, reading.po_no, reading.doc_type, reading.title, reading.reference, reading.doc_date, reading.claim_ref, reading.eot_days_claimed, reading.eot_days_assessed, reading.cost_claimed, reading.cost_assessed, reading.summary, JSON.stringify(reading.key_points ?? []), reading.matched_by, reading.confidence, reading.read_status, nowIso(), user.name, id);
  return getDoc(id)!;
}

const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Manual correction of where a document is filed and what it is. */
export function updateDoc(id: number, input: Record<string, unknown>, user: UserInfo): LibraryDoc {
  assertManage(user);
  const cur = getDoc(id);
  if (!cur) throw new ValidationError("Document not found.");
  const d = db();
  const next = {
    contractor_id: "contractor_id" in input ? num(input.contractor_id) : cur.contractor_id,
    contract_id: "contract_id" in input ? num(input.contract_id) : cur.contract_id,
    doc_type: "doc_type" in input ? str(input.doc_type, 80) : cur.doc_type,
    title: "title" in input ? str(input.title) : cur.title,
    reference: "reference" in input ? str(input.reference, 160) : cur.reference,
    doc_date: "doc_date" in input ? (/^\d{4}-\d{2}-\d{2}$/.test(String(input.doc_date ?? "")) ? String(input.doc_date) : null) : cur.doc_date,
    claim_ref: "claim_ref" in input ? str(input.claim_ref, 120) : cur.claim_ref,
    summary: "summary" in input ? str(input.summary, 4000) : cur.summary,
    eot_days_claimed: "eot_days_claimed" in input ? num(input.eot_days_claimed) : cur.eot_days_claimed,
    eot_days_assessed: "eot_days_assessed" in input ? num(input.eot_days_assessed) : cur.eot_days_assessed,
    cost_claimed: "cost_claimed" in input ? num(input.cost_claimed) : cur.cost_claimed,
    cost_assessed: "cost_assessed" in input ? num(input.cost_assessed) : cur.cost_assessed,
  };
  // the contract decides the contractor when only the contract was chosen
  if (next.contract_id && "contract_id" in input && !("contractor_id" in input)) {
    const c = d.prepare("SELECT contractor_id FROM contracts WHERE id = ?").get(next.contract_id) as { contractor_id: number | null } | undefined;
    if (c?.contractor_id) next.contractor_id = c.contractor_id;
  }
  d.prepare(
    `UPDATE library_docs SET contractor_id=?, contract_id=?, contract_code=NULL, po_no=NULL, doc_type=?, title=?, reference=?, doc_date=?, claim_ref=?, summary=?, eot_days_claimed=?, eot_days_assessed=?, cost_claimed=?, cost_assessed=?, matched_by='manual', confidence='Confirmed', read_status='Manual', updated_at=?, updated_by=? WHERE id=?`,
  ).run(next.contractor_id, next.contract_id, next.doc_type, next.title, next.reference, next.doc_date, next.claim_ref, next.summary, next.eot_days_claimed, next.eot_days_assessed, next.cost_claimed, next.cost_assessed, nowIso(), user.name, id);
  const row = getDoc(id)!;
  logAudit(getDb(), { registerKey: `library_${cur.library}`, recordId: id, action: "update", user, summary: `${LIBRARY_INFO[cur.library].short}: ${cur.rel_path} filed under ${row.contractor ?? "no contractor"}${row.contract_code ? ` · ${row.contract_code}` : ""}` });
  return row;
}

export function removeDoc(id: number, user: UserInfo, quiet = false) {
  assertManage(user);
  const cur = getDoc(id);
  if (!cur) return;
  const d = db();
  d.prepare("DELETE FROM library_docs WHERE id = ?").run(id);
  fs.rmSync(path.join(libraryDataDir(), cur.disk_path), { force: true });
  if (!quiet) logAudit(getDb(), { registerKey: `library_${cur.library}`, recordId: id, action: "delete", user, summary: `${LIBRARY_INFO[cur.library].short}: removed ${cur.rel_path}` });
}

/** Counts per library for the menu badges / Ask Me pack. */
export function libraryCounts(programmeId: number): Record<LibraryKey, number> {
  const rows = db().prepare("SELECT library, COUNT(*) AS n FROM library_docs WHERE programme_id = ? GROUP BY library").all(programmeId) as { library: LibraryKey; n: number }[];
  const out: Record<LibraryKey, number> = { eot: 0, contract: 0 };
  for (const r of rows) out[r.library] = r.n;
  return out;
}
