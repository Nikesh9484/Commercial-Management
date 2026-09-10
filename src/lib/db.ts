import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { allRegisters } from "./registers";
import type { FieldDef, RegisterDef } from "./registers/types";
import { nowIso, formatMonthYear } from "./format";

/**
 * Single SQLite connection for the whole app (kept on globalThis so hot-reload in
 * development does not open a new file handle every time).
 */
type G = typeof globalThis & { __cdDb?: Database.Database };

export function getDb(): Database.Database {
  const g = globalThis as G;
  if (g.__cdDb) return g.__cdDb;
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "commercial.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  seed(db);
  g.__cdDb = db;
  return db;
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export function sqlTypeFor(field: FieldDef): string {
  switch (field.type) {
    case "number":
    case "money":
    case "percent":
      return "REAL";
    case "boolean":
    case "lookup":
      return "INTEGER";
    default:
      return "TEXT";
  }
}

export function columnFor(field: FieldDef): string {
  return field.type === "password" ? "password_hash" : field.key;
}

/** Creates the table for a register if missing, and adds any new columns (safe to run every start). */
export function ensureRegisterTable(db: Database.Database, def: RegisterDef) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS "${def.table}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT,
      created_by TEXT,
      updated_at TEXT,
      updated_by TEXT
    )`,
  );
  const existing = new Set(
    (db.prepare(`PRAGMA table_info("${def.table}")`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const f of def.fields) {
    if (f.virtual) continue;
    const col = columnFor(f);
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE "${def.table}" ADD COLUMN "${col}" ${sqlTypeFor(f)}`);
    }
  }
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      register_key TEXT NOT NULL,
      record_id INTEGER,
      action TEXT NOT NULL,
      user_id INTEGER,
      user_name TEXT,
      at TEXT NOT NULL,
      summary TEXT,
      changes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_register ON audit_log(register_key, record_id);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_id INTEGER NOT NULL,
      register_key TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      taken_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snap_period ON snapshots(period_id, register_key);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS cashflow_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programme_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      forecast REAL,
      actual_override REAL,
      note TEXT,
      updated_at TEXT,
      updated_by TEXT,
      UNIQUE(contract_id, month)
    );

    CREATE TABLE IF NOT EXISTS report_checklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_id INTEGER NOT NULL,
      module_no INTEGER NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      done_by TEXT,
      done_at TEXT,
      comment TEXT,
      UNIQUE(period_id, module_no)
    );
  `);
  for (const def of allRegisters) ensureRegisterTable(db, def);
}

/* ------------------------------------------------------------------ */
/* Settings key/value                                                  */
/* ------------------------------------------------------------------ */

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string | null) {
  db.prepare("INSERT INTO app_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/* ------------------------------------------------------------------ */
/* First-run seed data                                                 */
/* ------------------------------------------------------------------ */

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

function seedList(db: Database.Database, table: string, names: string[], stamp: string) {
  if (count(db, table) > 0) return;
  const ins = db.prepare(`INSERT INTO "${table}"(name, sort_order, active, created_at, created_by, updated_at, updated_by) VALUES(?, ?, 1, ?, 'system', ?, 'system')`);
  names.forEach((name, i) => ins.run(name, (i + 1) * 10, stamp, stamp));
}

function seed(db: Database.Database) {
  const stamp = nowIso();

  // Admin user
  if (count(db, "users") === 0) {
    const email = (process.env.ADMIN_EMAIL || "admin@commercial.local").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "Admin@123";
    const name = process.env.ADMIN_NAME || "Commercial Manager";
    db.prepare(
      `INSERT INTO users(name, email, role, active, password_hash, created_at, created_by, updated_at, updated_by)
       VALUES(?, ?, 'admin', 1, ?, ?, 'system', ?, 'system')`,
    ).run(name, email, bcrypt.hashSync(password, 10), stamp, stamp);
  }

  seedList(db, "approval_statuses", ["Approved", "Rejected", "Pending", "Revised & Re-submit", "Superseded", "Cancelled", "Transferred", "Review Complete"], stamp);
  seedList(db, "change_initiators", ["Contract", "Consultant", "Contractor", "Employer", "Authority"], stamp);
  seedList(db, "project_stages", ["Pre-Contract Variation", "Post-Contract Variation", "Consultant Variation"], stamp);
  seedList(db, "change_categories", ["Design Dev", "Client Change", "Authority", "Brief Change", "EOT Claim", "Value Engineering"], stamp);
  seedList(
    db,
    "bond_types",
    [
      "Advance Payment Bond",
      "Performance Bond",
      "Retention Bond",
      "Contractors All Risks",
      "Employer's Liability",
      "Public/Third Party Liability",
      "Professional Indemnity",
      "Marine & Hull",
      "Plant & Equipment",
      "Motor Vehicle Liability",
      "Workmen's Compensation",
      "Trade License",
    ],
    stamp,
  );
  seedList(db, "ps_statuses", ["Approved", "Pending", "Expended", "Partially Expended", "Not Active"], stamp);

  // Example programme / asset so the top bar has something to show on day one.
  if (count(db, "programmes") === 0) {
    const client = db
      .prepare(`INSERT INTO clients(name, created_at, created_by, updated_at, updated_by) VALUES('Client (edit me)', ?, 'system', ?, 'system')`)
      .run(stamp, stamp);
    const loc = db
      .prepare(`INSERT INTO locations(name, country, created_at, created_by, updated_at, updated_by) VALUES('Location (edit me)', 'Saudi Arabia', ?, 'system', ?, 'system')`)
      .run(stamp, stamp);
    const prog = db
      .prepare(
        `INSERT INTO programmes(code, name, client_id, location_id, created_at, created_by, updated_at, updated_by)
         VALUES('1TB01031', 'Programme 1TB01031 (edit me)', ?, ?, ?, 'system', ?, 'system')`,
      )
      .run(client.lastInsertRowid, loc.lastInsertRowid, stamp, stamp);
    const asset = db
      .prepare(
        `INSERT INTO assets(programme_id, code, name, created_at, created_by, updated_at, updated_by)
         VALUES(?, '1TB01031.01', 'Asset 1TB01031.01 (edit me)', ?, 'system', ?, 'system')`,
      )
      .run(prog.lastInsertRowid, stamp, stamp);
    setSetting(db, "current_programme_id", String(prog.lastInsertRowid));
    setSetting(db, "current_asset_id", String(asset.lastInsertRowid));

    if (count(db, "packages") === 0) {
      const pk = db.prepare(
        `INSERT INTO packages(code, name, asset_id, sort_order, active, created_at, created_by, updated_at, updated_by)
         VALUES(?, ?, ?, ?, 1, ?, 'system', ?, 'system')`,
      );
      const names = [
        "Early Works",
        "Prelims",
        "Main Works – Basin",
        "Main Works – Fixed Jetty",
        "Marine Furniture",
        "Boardwalk & Jetty",
        "Marine Survey",
        "Navigation Simulation",
        "Provisional Sums",
      ];
      names.forEach((n, i) => pk.run(`PK-${String(i + 1).padStart(2, "0")}`, n, asset.lastInsertRowid, (i + 1) * 10, stamp, stamp));
    }
  }

  // First reporting period = this month, open.
  if (count(db, "reporting_periods") === 0) {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const label = `Monthly Report No 1 – ${formatMonthYear(end)}`;
    const r = db
      .prepare(
        `INSERT INTO reporting_periods(report_no, period_start, period_end, label, status, created_at, created_by, updated_at, updated_by)
         VALUES(1, ?, ?, ?, 'Open', ?, 'system', ?, 'system')`,
      )
      .run(start, end, label, stamp, stamp);
    setSetting(db, "current_period_id", String(r.lastInsertRowid));
  }
}
