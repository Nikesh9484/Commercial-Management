import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { dataDir, dropFile, keepFile, restoreFileSync } from "../file-store";
import { nowIso } from "../format";
import type { UserInfo } from "../registers/types";

/**
 * The documents behind a bond or insurance entry – the guarantee, the certificate, an amendment, the
 * transmittal that sent it – kept with the entry so the evidence can be opened from the register.
 * Files live under the data folder (and in the backup store, so a disk reset does not lose them).
 */
export interface BondDocument {
  id: number;
  bond_id: number;
  name: string;
  disk_path: string;
  size: number;
  note: string;
  uploaded_at: string;
  uploaded_by: string;
}

export function ensureBondDocuments(db: Database.Database = getDb()) {
  db.exec(`CREATE TABLE IF NOT EXISTS bond_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bond_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    disk_path TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    uploaded_at TEXT,
    uploaded_by TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS bond_documents_bond ON bond_documents(bond_id)");
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "document";

/** Keeps the files with the entry; a file of the same name already kept is replaced. */
export function attachBondDocuments(bondId: number, files: { name: string; bytes: Buffer }[], user: UserInfo, note = ""): BondDocument[] {
  const db = getDb();
  ensureBondDocuments(db);
  const dir = path.join(dataDir(), "bond-docs", String(bondId));
  fs.mkdirSync(dir, { recursive: true });
  const out: BondDocument[] = [];
  for (const f of files) {
    const name = safeName(f.name);
    const existing = db.prepare("SELECT id, disk_path FROM bond_documents WHERE bond_id = ? AND name = ?").get(bondId, name) as { id: number; disk_path: string } | undefined;
    if (existing) {
      const old = path.join(dataDir(), existing.disk_path);
      fs.rmSync(old, { force: true });
      dropFile(old);
      db.prepare("DELETE FROM bond_documents WHERE id = ?").run(existing.id);
    }
    const disk = path.join(dir, name);
    fs.writeFileSync(disk, f.bytes);
    keepFile(disk);
    const r = db.prepare("INSERT INTO bond_documents(bond_id, name, disk_path, size, note, uploaded_at, uploaded_by) VALUES(?,?,?,?,?,?,?)").run(bondId, name, path.relative(dataDir(), disk).split(path.sep).join("/"), f.bytes.length, note, nowIso(), user.name);
    out.push(db.prepare("SELECT * FROM bond_documents WHERE id = ?").get(Number(r.lastInsertRowid)) as BondDocument);
  }
  return out;
}

export function listBondDocuments(bondIds: number[]): Map<number, BondDocument[]> {
  const out = new Map<number, BondDocument[]>();
  if (!bondIds.length) return out;
  const db = getDb();
  ensureBondDocuments(db);
  const rows = db.prepare(`SELECT * FROM bond_documents WHERE bond_id IN (${bondIds.map(() => "?").join(",")}) ORDER BY uploaded_at, id`).all(...bondIds) as BondDocument[];
  for (const r of rows) out.set(r.bond_id, [...(out.get(r.bond_id) ?? []), r]);
  return out;
}

export function readBondDocument(id: number): { doc: BondDocument; bytes: Buffer } | null {
  const db = getDb();
  ensureBondDocuments(db);
  const doc = db.prepare("SELECT * FROM bond_documents WHERE id = ?").get(id) as BondDocument | undefined;
  if (!doc) return null;
  const p = path.join(dataDir(), doc.disk_path);
  if (!fs.existsSync(p) && !restoreFileSync(p)) return null;
  return { doc, bytes: fs.readFileSync(p) };
}
