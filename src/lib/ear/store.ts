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
 * Automation → Claim EAR (Employer's Assessment Report).
 *
 * A "case" is one contractor claim being assessed. Every document the Commercial Manager uploads
 * for it is kept on disk under the data folder (any file type) and its readable text is extracted
 * into the database, so the assessment engine can read the whole submission, the contract and the
 * template without opening the files again.
 */
export const EAR_BUCKETS = ["submission", "template", "contract", "prev_ear", "prev_submission"] as const;
export type EarBucket = (typeof EAR_BUCKETS)[number];

export const BUCKET_INFO: Record<EarBucket, { title: string; hint: string; revisedOnly?: boolean; single?: boolean }> = {
  submission: { title: "Contractor's claim & supporting documents", hint: "The whole claim folder: narrative, notices, programmes (XER), delay analysis, cost build-ups, correspondence, photos – any file type." },
  template: { title: "EAR template (Word or PDF)", hint: "Your Employer's Assessment Report template. Its headings and wording drive the structure of the report.", single: true },
  contract: { title: "Contract documents", hint: "The whole contract folder: conditions of contract, particular conditions, specifications, programme requirements, letters – any file type." },
  prev_ear: { title: "Previous EAR (revised submissions only)", hint: "The Employer's Assessment Report issued for the previous submission. The revised EAR is written on top of it with tracked changes.", revisedOnly: true },
  prev_submission: { title: "Previous contractor submission (revised submissions only)", hint: "The contractor's earlier submission, so the report explains what changed in the revision.", revisedOnly: true },
};

export interface EarCase {
  id: number;
  programme_id: number | null;
  title: string;
  contractor: string;
  contract_no: string;
  claim_ref: string;
  submission_ref: string;
  submission_date: string;
  revised: number;
  revision_no: number;
  status: "Draft" | "Generated" | "Generating" | "Failed";
  output_name: string | null;
  output_json: string | null;
  generated_at: string | null;
  generation_note: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface EarFile {
  id: number;
  case_id: number;
  bucket: EarBucket;
  name: string;
  rel_path: string;
  size: number;
  mime: string;
  kind: string;
  text_chars: number;
  note: string | null;
  created_at: string;
  created_by: string;
}

/** Largest single file accepted (per document). */
export const EAR_MAX_FILE_BYTES = 60 * 1024 * 1024;
/** Total size allowed for one case (all five buckets). */
export const EAR_MAX_CASE_BYTES = 800 * 1024 * 1024;

export function earDataDir(): string {
  const base = process.env.DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), "data"));
  const dir = path.join(base, "ear");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureEarTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ear_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programme_id INTEGER,
      title TEXT NOT NULL,
      contractor TEXT DEFAULT '',
      contract_no TEXT DEFAULT '',
      claim_ref TEXT DEFAULT '',
      submission_ref TEXT DEFAULT '',
      submission_date TEXT DEFAULT '',
      revised INTEGER DEFAULT 0,
      revision_no INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Draft',
      output_name TEXT,
      output_json TEXT,
      generated_at TEXT,
      generation_note TEXT,
      created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS ear_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      bucket TEXT NOT NULL,
      name TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      mime TEXT DEFAULT '',
      kind TEXT DEFAULT '',
      text TEXT,
      text_chars INTEGER DEFAULT 0,
      note TEXT,
      created_at TEXT, created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ear_files_case ON ear_files(case_id, bucket);
  `);
}

function db() {
  const d = getDb();
  ensureEarTables(d);
  return d;
}

export function canUseEar(user: UserInfo): boolean {
  return user.role === "admin" || user.role === "editor";
}
function assertUser(user: UserInfo) {
  if (!canUseEar(user)) throw new AuthError("Only Editors and Admins can use the Claim EAR automation.");
}

const FILE_COLS = "id, case_id, bucket, name, rel_path, size, mime, kind, text_chars, note, created_at, created_by";

export function listCases(programmeId: number | null): (EarCase & { files: number; bytes: number })[] {
  const d = db();
  const rows = (programmeId
    ? d.prepare("SELECT * FROM ear_cases WHERE programme_id = ? OR programme_id IS NULL ORDER BY updated_at DESC").all(programmeId)
    : d.prepare("SELECT * FROM ear_cases ORDER BY updated_at DESC").all()) as EarCase[];
  const stat = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS b FROM ear_files WHERE case_id = ?");
  return rows.map((r) => {
    const s = stat.get(r.id) as { n: number; b: number };
    return { ...r, files: s.n, bytes: s.b };
  });
}

export function getCase(id: number): EarCase | null {
  return (db().prepare("SELECT * FROM ear_cases WHERE id = ?").get(id) as EarCase | undefined) ?? null;
}

export function listFiles(caseId: number): EarFile[] {
  return db().prepare(`SELECT ${FILE_COLS} FROM ear_files WHERE case_id = ? ORDER BY bucket, name`).all(caseId) as EarFile[];
}

export function fileText(fileId: number): string {
  const r = db().prepare("SELECT text FROM ear_files WHERE id = ?").get(fileId) as { text: string | null } | undefined;
  return r?.text ?? "";
}

export function getFile(caseId: number, fileId: number): EarFile | null {
  return (db().prepare(`SELECT ${FILE_COLS} FROM ear_files WHERE id = ? AND case_id = ?`).get(fileId, caseId) as EarFile | undefined) ?? null;
}

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

export function createCase(input: Record<string, unknown>, programmeId: number | null, user: UserInfo): EarCase {
  assertUser(user);
  const title = str(input.title);
  if (!title) throw new ValidationError("Give the case a title, e.g. the claim name.", { title: "Required" });
  const stamp = nowIso();
  const revised = input.revised ? 1 : 0;
  const revision_no = Math.max(0, Number(input.revision_no) || (revised ? 1 : 0));
  const r = db()
    .prepare(
      `INSERT INTO ear_cases(programme_id, title, contractor, contract_no, claim_ref, submission_ref, submission_date, revised, revision_no, status, created_at, created_by, updated_at, updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,'Draft',?,?,?,?)`,
    )
    .run(programmeId, title, str(input.contractor), str(input.contract_no, 60), str(input.claim_ref, 80), str(input.submission_ref, 120), str(input.submission_date, 20), revised, revision_no, stamp, user.name, stamp, user.name);
  const row = getCase(Number(r.lastInsertRowid))!;
  logAudit(getDb(), { registerKey: "ear_cases", recordId: row.id, action: "create", user, summary: `Claim EAR case created: ${title}` });
  return row;
}

export function updateCase(id: number, input: Record<string, unknown>, user: UserInfo): EarCase {
  assertUser(user);
  const cur = getCase(id);
  if (!cur) throw new ValidationError("Case not found.");
  const next = {
    title: "title" in input ? str(input.title) : cur.title,
    contractor: "contractor" in input ? str(input.contractor) : cur.contractor,
    contract_no: "contract_no" in input ? str(input.contract_no, 60) : cur.contract_no,
    claim_ref: "claim_ref" in input ? str(input.claim_ref, 80) : cur.claim_ref,
    submission_ref: "submission_ref" in input ? str(input.submission_ref, 120) : cur.submission_ref,
    submission_date: "submission_date" in input ? str(input.submission_date, 20) : cur.submission_date,
    revised: "revised" in input ? (input.revised ? 1 : 0) : cur.revised,
    revision_no: "revision_no" in input ? Math.max(0, Number(input.revision_no) || 0) : cur.revision_no,
  };
  if (!next.title) throw new ValidationError("The title cannot be empty.", { title: "Required" });
  if (next.revised && next.revision_no < 1) next.revision_no = 1;
  db()
    .prepare("UPDATE ear_cases SET title=?, contractor=?, contract_no=?, claim_ref=?, submission_ref=?, submission_date=?, revised=?, revision_no=?, updated_at=?, updated_by=? WHERE id=?")
    .run(next.title, next.contractor, next.contract_no, next.claim_ref, next.submission_ref, next.submission_date, next.revised, next.revision_no, nowIso(), user.name, id);
  logAudit(getDb(), { registerKey: "ear_cases", recordId: id, action: "update", user, summary: `Claim EAR case updated: ${next.title}` });
  return getCase(id)!;
}

export function deleteCase(id: number, user: UserInfo) {
  assertUser(user);
  const cur = getCase(id);
  if (!cur) return;
  const d = db();
  d.prepare("DELETE FROM ear_files WHERE case_id = ?").run(id);
  d.prepare("DELETE FROM ear_cases WHERE id = ?").run(id);
  fs.rmSync(path.join(earDataDir(), String(id)), { recursive: true, force: true });
  logAudit(getDb(), { registerKey: "ear_cases", recordId: id, action: "delete", user, summary: `Claim EAR case deleted: ${cur.title}` });
}

/** A safe file name for disk (the original name is kept in the database). */
function safeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  return base || "file";
}

export function addFile(
  caseId: number,
  bucket: string,
  input: { name: string; relPath?: string; bytes: Buffer; mime?: string },
  extracted: { kind: string; text: string; note: string | null },
  user: UserInfo,
): EarFile {
  assertUser(user);
  if (!(EAR_BUCKETS as readonly string[]).includes(bucket)) throw new ValidationError("Unknown document group.");
  const cur = getCase(caseId);
  if (!cur) throw new ValidationError("Case not found.");
  if (input.bytes.length > EAR_MAX_FILE_BYTES) throw new ValidationError(`${input.name} is larger than ${Math.round(EAR_MAX_FILE_BYTES / 1024 / 1024)} MB. Split it or compress it and try again.`);
  const d = db();
  const used = (d.prepare("SELECT COALESCE(SUM(size),0) AS b FROM ear_files WHERE case_id = ?").get(caseId) as { b: number }).b;
  if (used + input.bytes.length > EAR_MAX_CASE_BYTES) throw new ValidationError(`This case already holds ${Math.round(used / 1024 / 1024)} MB; the limit is ${Math.round(EAR_MAX_CASE_BYTES / 1024 / 1024)} MB per case.`);
  if (BUCKET_INFO[bucket as EarBucket].single) {
    // one template / one previous EAR: replace the earlier one
    for (const old of d.prepare(`SELECT ${FILE_COLS} FROM ear_files WHERE case_id = ? AND bucket = ?`).all(caseId, bucket) as EarFile[]) removeFile(caseId, old.id, user, true);
  }
  const dir = path.join(earDataDir(), String(caseId), bucket);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = nowIso();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const disk = `${id}-${safeName(input.name)}`;
  fs.writeFileSync(path.join(dir, disk), input.bytes);
  const rel = (input.relPath || input.name).replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 400);
  const r = d
    .prepare(
      `INSERT INTO ear_files(case_id, bucket, name, rel_path, size, mime, kind, text, text_chars, note, created_at, created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(caseId, bucket, path.join(bucket, disk), rel, input.bytes.length, input.mime ?? "", extracted.kind, extracted.text, extracted.text.length, extracted.note, stamp, user.name);
  d.prepare("UPDATE ear_cases SET updated_at = ?, updated_by = ? WHERE id = ?").run(stamp, user.name, caseId);
  return getFile(caseId, Number(r.lastInsertRowid))!;
}

export function removeFile(caseId: number, fileId: number, user: UserInfo, quiet = false) {
  assertUser(user);
  const f = getFile(caseId, fileId);
  if (!f) return;
  fs.rmSync(path.join(earDataDir(), String(caseId), f.name), { force: true });
  db().prepare("DELETE FROM ear_files WHERE id = ?").run(fileId);
  if (!quiet) db().prepare("UPDATE ear_cases SET updated_at = ?, updated_by = ? WHERE id = ?").run(nowIso(), user.name, caseId);
}

export function filePath(caseId: number, f: EarFile): string {
  return path.join(earDataDir(), String(caseId), f.name);
}

export function outputPath(caseId: number): string {
  return path.join(earDataDir(), String(caseId), "EAR.docx");
}

export function setGeneration(id: number, patch: { status: EarCase["status"]; output_name?: string | null; output_json?: string | null; note?: string | null }, user: UserInfo) {
  const stamp = nowIso();
  db()
    .prepare("UPDATE ear_cases SET status=?, output_name=COALESCE(?, output_name), output_json=COALESCE(?, output_json), generated_at=CASE WHEN ?='Generated' THEN ? ELSE generated_at END, generation_note=?, updated_at=?, updated_by=? WHERE id=?")
    .run(patch.status, patch.output_name ?? null, patch.output_json ?? null, patch.status, stamp, patch.note ?? null, stamp, user.name, id);
}
