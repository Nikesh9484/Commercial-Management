import type Database from "better-sqlite3";
import { getDb, getSetting, setSetting } from "./db";
import { allRegisters } from "./registers";
import { columnFor } from "./db";
import { listRecords, ValidationError } from "./registers/engine";
import { logAudit } from "./audit";
import { nowIso, todayIso } from "./format";
import type { RecordRow, UserInfo } from "./registers/types";
import { AuthError } from "./auth";
import { snapshotCostReport } from "./cost-report/compute";
import { getCashflow } from "./cashflow/compute";

export interface PeriodRow extends RecordRow {
  report_no: number;
  label: string;
  period_start: string | null;
  period_end: string;
  status: "Open" | "Locked";
  locked_at: string | null;
  locked_by: string | null;
}

export function getPeriod(id: number): PeriodRow | null {
  return (getDb().prepare("SELECT * FROM reporting_periods WHERE id = ?").get(id) as PeriodRow | undefined) ?? null;
}

export function listPeriods(): PeriodRow[] {
  return getDb().prepare("SELECT * FROM reporting_periods ORDER BY report_no DESC").all() as PeriodRow[];
}

/** Locks a period: stores a copy of every snapshot-enabled register so it can be compared later. */
/** The report with the highest number – the one the live registers belong to. */
export function latestPeriod(db: Database.Database = getDb()): PeriodRow | null {
  return (db.prepare("SELECT * FROM reporting_periods ORDER BY report_no DESC LIMIT 1").get() as PeriodRow | undefined) ?? null;
}

/** Does the period have a stored copy of its data (taken at import, at lock, or when the next month started)? */
export function hasStoredCopy(db: Database.Database, periodId: number): boolean {
  return !!db.prepare("SELECT 1 FROM snapshots WHERE period_id = ? AND register_key = 'cost_report' LIMIT 1").get(periodId);
}

/** When the stored copy was taken. */
export function storedCopyAt(db: Database.Database, periodId: number): string | null {
  return (db.prepare("SELECT MAX(taken_at) AS t FROM snapshots WHERE period_id = ?").get(periodId) as { t: string | null }).t;
}

/**
 * Every report keeps its own data: the live registers belong to the latest report, every earlier
 * report (and every locked one) is read from its stored copy. True when this period reads its copy.
 */
export function readsStoredCopy(db: Database.Database, period: Pick<PeriodRow, "id" | "status" | "report_no">): boolean {
  if (!hasStoredCopy(db, period.id)) return false;
  if (period.status === "Locked") return true;
  const latest = latestPeriod(db);
  return !!latest && latest.id !== period.id;
}

/** Stores a copy of every snapshot register, the computed cost report and the cash flow for the period (status unchanged). */
export function takeSnapshot(periodId: number, user: UserInfo | null, reason: "lock" | "import" | "new month" | "preserve"): { registers: number; records: number } {
  const db = getDb();
  const period = getPeriod(periodId);
  if (!period) throw new ValidationError("Reporting period not found.");
  const stamp = nowIso();
  let registers = 0;
  let records = 0;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM snapshots WHERE period_id = ?").run(periodId);
    const ins = db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, ?, ?, ?, ?)");
    for (const def of allRegisters) {
      if (!def.snapshot) continue;
      registers++;
      for (const row of listRecords(def, { allScopes: true })) {
        ins.run(periodId, def.key, row.id, JSON.stringify(row), stamp);
        records++;
      }
    }
    // Calculated reports are stored too, so "Previous Period" columns can be read back later.
    records += snapshotCostReport(db, periodId, stamp);
    registers++;
    const cfIns = db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, 'cashflow', ?, ?, ?)");
    for (const p of db.prepare("SELECT id FROM programmes").all() as { id: number }[]) {
      cfIns.run(periodId, p.id, JSON.stringify(getCashflow(db, p.id)), stamp);
      records++;
    }
    registers++;
  });
  tx();
  if (reason !== "lock") logAudit(db, { registerKey: "reporting_periods", recordId: periodId, action: "context", user, summary: `Stored the data of ${period.label} (${reason}: ${records} record(s) across ${registers} register(s))` });
  return { registers, records };
}

/**
 * Puts the live registers back to a period's stored copy (used after an older month was imported, so
 * the latest month's live figures are untouched). Reference data (settings lists) is not affected.
 */
export function restoreFromSnapshot(db: Database.Database, periodId: number): number {
  let restored = 0;
  const tx = db.transaction(() => {
    for (const def of allRegisters) {
      if (!def.snapshot) continue;
      const rows = db.prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = ? ORDER BY record_id").all(periodId, def.key) as { data: string }[];
      const cols = new Set((db.prepare(`PRAGMA table_info("${def.table}")`).all() as { name: string }[]).map((c) => c.name));
      db.prepare(`DELETE FROM "${def.table}"`).run();
      for (const r of rows) {
        const row = JSON.parse(r.data) as Record<string, unknown>;
        const keys = ["id", "created_at", "created_by", "updated_at", "updated_by", ...def.fields.filter((f) => !f.virtual).map((f) => columnFor(f))].filter((k) => cols.has(k) && row[k] !== undefined);
        const vals = keys.map((k) => {
          const v = row[k];
          return typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : (v as string | number | null);
        });
        db.prepare(`INSERT INTO "${def.table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...vals);
        restored++;
      }
    }
  });
  tx();
  return restored;
}

/** Empties every snapshot register (used as the starting point when an older month is imported and no earlier report is stored). */
export function clearSnapshotRegisters(db: Database.Database): void {
  const tx = db.transaction(() => {
    for (const def of allRegisters) if (def.snapshot) db.prepare(`DELETE FROM "${def.table}"`).run();
  });
  tx();
}

/** The nearest stored report before the given report number, if any. */
export function nearestStoredBefore(db: Database.Database, reportNo: number): PeriodRow | null {
  return (
    (db
      .prepare("SELECT p.* FROM reporting_periods p WHERE p.report_no < ? AND EXISTS (SELECT 1 FROM snapshots s WHERE s.period_id = p.id AND s.register_key = 'cost_report') ORDER BY p.report_no DESC LIMIT 1")
      .get(reportNo) as PeriodRow | undefined) ?? null
  );
}

/**
 * Locks (issues) a report. The latest report is frozen from the live registers; an earlier report keeps
 * the copy stored when it was imported, so locking it later never captures another month's figures.
 */
export function lockPeriod(periodId: number, user: UserInfo, opts: { force?: boolean } = {}): { registers: number; records: number } {
  if (user.role !== "admin") throw new AuthError("Only an Admin can lock a reporting period.");
  const db = getDb();
  const period = getPeriod(periodId);
  if (!period) throw new ValidationError("Reporting period not found.");
  const latest = latestPeriod(db);
  const isLatest = !latest || latest.id === periodId;
  let counts: { registers: number; records: number };
  if (isLatest || !hasStoredCopy(db, periodId)) {
    if (!isLatest && !opts.force) {
      throw new ValidationError(
        `${period.label} has no stored data of its own and ${latest!.label} already exists, so the live figures are ${latest!.label}'s. Re-upload ${period.label}'s workbook first (Monthly Report → All reports → Re-upload); it is stored on import and can then be locked. Lock anyway only if the live figures really are ${period.label}'s.`,
        { force: "confirm" },
      );
    }
    counts = takeSnapshot(periodId, user, "lock");
  } else {
    counts = { registers: 0, records: (db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE period_id = ?").get(periodId) as { n: number }).n };
  }
  db.prepare("UPDATE reporting_periods SET status = 'Locked', locked_at = ?, locked_by = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(todayIso(), user.name, nowIso(), user.name, periodId);
  logAudit(db, {
    registerKey: "reporting_periods",
    recordId: periodId,
    action: "lock",
    user,
    summary: `Locked ${period.label} (${counts.registers ? `snapshot of ${counts.records} record(s) across ${counts.registers} register(s)` : `issued with its stored data, ${counts.records} record(s)`})`,
    changes: { status: { from: "Open", to: "Locked" } },
  });
  return counts;
}

export function unlockPeriod(periodId: number, user: UserInfo) {
  if (user.role !== "admin") throw new AuthError("Only an Admin can unlock a reporting period.");
  const db = getDb();
  const period = getPeriod(periodId);
  if (!period) throw new ValidationError("Reporting period not found.");
  db.prepare("UPDATE reporting_periods SET status = 'Open', updated_at = ?, updated_by = ? WHERE id = ?").run(nowIso(), user.name, periodId);
  logAudit(db, {
    registerKey: "reporting_periods",
    recordId: periodId,
    action: "unlock",
    user,
    summary: `Unlocked ${period.label} (its stored data is kept; only the latest report is edited live)`,
    changes: { status: { from: "Locked", to: "Open" } },
  });
}

/** Snapshot rows of a register for a given period (for "Previous Period" comparisons in later modules). */
export function getSnapshot(periodId: number, registerKey: string): RecordRow[] {
  const rows = getDb().prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = ?").all(periodId, registerKey) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as RecordRow);
}

export function snapshotCounts(periodId: number): Record<string, number> {
  const rows = getDb().prepare("SELECT register_key, COUNT(*) AS n FROM snapshots WHERE period_id = ? GROUP BY register_key").all(periodId) as { register_key: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.register_key, r.n]));
}

/** The period shown in the top bar. Falls back to the latest open period. */
export function getCurrentPeriod(): PeriodRow | null {
  const db = getDb();
  const id = getSetting(db, "current_period_id");
  if (id) {
    const p = getPeriod(Number(id));
    if (p) return p;
  }
  const latest = db.prepare("SELECT * FROM reporting_periods ORDER BY report_no DESC LIMIT 1").get() as PeriodRow | undefined;
  if (latest) setSetting(db, "current_period_id", String(latest.id));
  return latest ?? null;
}

/** The period before the current one (used for This Period vs Previous Period). */
export function getPreviousPeriod(current: PeriodRow | null): PeriodRow | null {
  if (!current) return null;
  return (
    (getDb().prepare("SELECT * FROM reporting_periods WHERE report_no < ? ORDER BY report_no DESC LIMIT 1").get(current.report_no) as PeriodRow | undefined) ??
    null
  );
}
