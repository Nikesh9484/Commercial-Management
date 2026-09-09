import type Database from "better-sqlite3";
import type { AuditEntry, UserInfo } from "./registers/types";
import { nowIso } from "./format";

export function logAudit(
  db: Database.Database,
  entry: {
    registerKey: string;
    recordId: number | null;
    action: "create" | "update" | "delete" | "import" | "lock" | "unlock" | "login" | "context";
    user: UserInfo | null;
    summary: string;
    changes?: Record<string, { from: unknown; to: unknown }> | null;
  },
) {
  db.prepare(
    `INSERT INTO audit_log(register_key, record_id, action, user_id, user_name, at, summary, changes)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.registerKey,
    entry.recordId,
    entry.action,
    entry.user?.id ?? null,
    entry.user?.name ?? "system",
    nowIso(),
    entry.summary,
    entry.changes ? JSON.stringify(entry.changes) : null,
  );
}

type Raw = { id: number; register_key: string; record_id: number | null; action: string; user_name: string; at: string; summary: string; changes: string | null };

function map(r: Raw): AuditEntry {
  return { ...r, changes: r.changes ? JSON.parse(r.changes) : null };
}

export function getRecordHistory(db: Database.Database, registerKey: string, recordId: number): AuditEntry[] {
  const rows = db
    .prepare("SELECT * FROM audit_log WHERE register_key = ? AND record_id = ? ORDER BY at DESC, id DESC LIMIT 200")
    .all(registerKey, recordId) as Raw[];
  return rows.map(map);
}

export function getRecentActivity(db: Database.Database, limit = 200, registerKey?: string): AuditEntry[] {
  const rows = (
    registerKey
      ? db.prepare("SELECT * FROM audit_log WHERE register_key = ? ORDER BY at DESC, id DESC LIMIT ?").all(registerKey, limit)
      : db.prepare("SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?").all(limit)
  ) as Raw[];
  return rows.map(map);
}
