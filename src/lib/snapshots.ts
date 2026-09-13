import type Database from "better-sqlite3";
import { getDb, getSetting, setSetting } from "./db";
import { allRegisters } from "./registers";
import { columnFor } from "./db";
import { listRecords, ValidationError } from "./registers/engine";
import { logAudit } from "./audit";
import { nowIso, todayIso } from "./format";
import type { RecordRow, UserInfo, RegisterDef } from "./registers/types";
import { AuthError } from "./auth";
import { snapshotCostReport } from "./cost-report/compute";
import { getCashflow } from "./cashflow/compute";

/**
 * Every project (programme row: The Marina, Village Boutique Hotel …) keeps its own reporting
 * periods, report library, stored copies and live registers. Nothing here ever reads or writes
 * another project's data.
 */
export interface PeriodRow extends RecordRow {
  programme_id: number;
  report_no: number;
  label: string;
  period_start: string | null;
  period_end: string;
  status: "Open" | "Locked";
  locked_at: string | null;
  locked_by: string | null;
}

/** The project (programme) selected in the top bar. */
export function currentProgrammeId(db: Database.Database = getDb()): number | null {
  const v = getSetting(db, "current_programme_id");
  if (v) return Number(v);
  const first = db.prepare("SELECT id FROM programmes ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  return first?.id ?? null;
}

export function getPeriod(id: number): PeriodRow | null {
  return (getDb().prepare("SELECT * FROM reporting_periods WHERE id = ?").get(id) as PeriodRow | undefined) ?? null;
}

/** The reports of one project (the top-bar project by default), newest first. */
export function listPeriods(programmeId: number | null = currentProgrammeId()): PeriodRow[] {
  if (!programmeId) return [];
  return getDb().prepare("SELECT * FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC").all(programmeId) as PeriodRow[];
}

/** The report with the highest number in a project – the one the live registers belong to. */
export function latestPeriod(db: Database.Database = getDb(), programmeId: number | null = currentProgrammeId(db)): PeriodRow | null {
  if (!programmeId) return null;
  return (db.prepare("SELECT * FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC LIMIT 1").get(programmeId) as PeriodRow | undefined) ?? null;
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
export function readsStoredCopy(db: Database.Database, period: Pick<PeriodRow, "id" | "status" | "report_no" | "programme_id">): boolean {
  if (!hasStoredCopy(db, period.id)) return false;
  if (period.status === "Locked") return true;
  const latest = latestPeriod(db, period.programme_id);
  return !!latest && latest.id !== period.id;
}

/** The asset ids of a project (asset-scoped registers are filtered through them). */
function assetIdsOf(db: Database.Database, programmeId: number): Set<number> {
  return new Set((db.prepare("SELECT id FROM assets WHERE programme_id = ?").all(programmeId) as { id: number }[]).map((a) => a.id));
}

/** Live rows of a register that belong to one project. */
export function projectRows(def: RegisterDef, programmeId: number, db: Database.Database = getDb()): RecordRow[] {
  const rows = listRecords(def, { allScopes: true });
  if (def.scope === "programme") return rows.filter((r) => Number(r.programme_id) === programmeId);
  if (def.scope === "asset") {
    const assets = assetIdsOf(db, programmeId);
    return rows.filter((r) => assets.has(Number(r.asset_id)));
  }
  return rows;
}

/** SQL filter that limits a register's table to one project ("" when the register is not scoped). */
function projectWhere(db: Database.Database, def: RegisterDef, programmeId: number): { sql: string; args: number[] } {
  if (def.scope === "programme") return { sql: "WHERE programme_id = ?", args: [programmeId] };
  if (def.scope === "asset") {
    const ids = [...assetIdsOf(db, programmeId)];
    return { sql: `WHERE asset_id IN (${ids.map(() => "?").join(",") || "-1"})`, args: ids };
  }
  return { sql: "", args: [] };
}

/** Stores a copy of every snapshot register, the computed cost report and the cash flow for the period's project (status unchanged). */
export function takeSnapshot(periodId: number, user: UserInfo | null, reason: "lock" | "import" | "new month" | "preserve"): { registers: number; records: number } {
  const db = getDb();
  const period = getPeriod(periodId);
  if (!period) throw new ValidationError("Reporting period not found.");
  const programmeId = period.programme_id;
  const stamp = nowIso();
  let registers = 0;
  let records = 0;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM snapshots WHERE period_id = ?").run(periodId);
    const ins = db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, ?, ?, ?, ?)");
    for (const def of allRegisters) {
      if (!def.snapshot) continue;
      registers++;
      for (const row of projectRows(def, programmeId, db)) {
        ins.run(periodId, def.key, row.id, JSON.stringify(row), stamp);
        records++;
      }
    }
    // Calculated reports are stored too, so "Previous Period" columns can be read back later.
    records += snapshotCostReport(db, periodId, stamp, programmeId);
    registers++;
    db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, 'cashflow', ?, ?, ?)").run(periodId, programmeId, JSON.stringify(getCashflow(db, programmeId)), stamp);
    records++;
    registers++;
  });
  tx();
  if (reason !== "lock") logAudit(db, { registerKey: "reporting_periods", recordId: periodId, action: "context", user, summary: `Stored the data of ${period.label} (${reason}: ${records} record(s) across ${registers} register(s))` });
  return { registers, records };
}

/**
 * Puts a project's live registers back to a period's stored copy (used after an older month was
 * imported, so the latest month's live figures are untouched). Other projects and the reference
 * data (settings lists) are not affected.
 */
export function restoreFromSnapshot(db: Database.Database, periodId: number): number {
  const period = getPeriod(periodId);
  if (!period) throw new ValidationError("Reporting period not found.");
  const programmeId = period.programme_id;
  let restored = 0;
  const tx = db.transaction(() => {
    for (const def of allRegisters) {
      if (!def.snapshot) continue;
      const rows = db.prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = ? ORDER BY record_id").all(periodId, def.key) as { data: string }[];
      const cols = new Set((db.prepare(`PRAGMA table_info("${def.table}")`).all() as { name: string }[]).map((c) => c.name));
      const w = projectWhere(db, def, programmeId);
      db.prepare(`DELETE FROM "${def.table}" ${w.sql}`).run(...w.args);
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

/** Empties a project's snapshot registers (used as the starting point when an older month is imported and no earlier report is stored). */
export function clearSnapshotRegisters(db: Database.Database, programmeId: number): void {
  const tx = db.transaction(() => {
    for (const def of allRegisters) {
      if (!def.snapshot) continue;
      const w = projectWhere(db, def, programmeId);
      db.prepare(`DELETE FROM "${def.table}" ${w.sql}`).run(...w.args);
    }
  });
  tx();
}

/** The nearest stored report of a project before the given report number, if any. */
export function nearestStoredBefore(db: Database.Database, reportNo: number, programmeId: number): PeriodRow | null {
  return (
    (db
      .prepare(
        "SELECT p.* FROM reporting_periods p WHERE p.programme_id = ? AND p.report_no < ? AND EXISTS (SELECT 1 FROM snapshots s WHERE s.period_id = p.id AND s.register_key = 'cost_report') ORDER BY p.report_no DESC LIMIT 1",
      )
      .get(programmeId, reportNo) as PeriodRow | undefined) ?? null
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
  const latest = latestPeriod(db, period.programme_id);
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
    changes: { status: { from: "Open", to: "Locked" } },
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

/**
 * The period shown in the top bar for the current project. Falls back to the project's latest report
 * (and remembers it), so switching projects never shows another project's report.
 */
export function getCurrentPeriod(programmeId: number | null = currentProgrammeId()): PeriodRow | null {
  const db = getDb();
  if (!programmeId) return null;
  const id = getSetting(db, "current_period_id");
  if (id) {
    const p = getPeriod(Number(id));
    if (p && p.programme_id === programmeId) return p;
  }
  const remembered = getSetting(db, `current_period_id:${programmeId}`);
  const back = remembered ? getPeriod(Number(remembered)) : null;
  const pick = back && back.programme_id === programmeId ? back : latestPeriod(db, programmeId);
  if (pick) setSetting(db, "current_period_id", String(pick.id));
  return pick ?? null;
}

/** The period before the current one in the same project (used for This Period vs Previous Period). */
export function getPreviousPeriod(current: PeriodRow | null): PeriodRow | null {
  if (!current) return null;
  return (
    (getDb().prepare("SELECT * FROM reporting_periods WHERE programme_id = ? AND report_no < ? ORDER BY report_no DESC LIMIT 1").get(current.programme_id, current.report_no) as PeriodRow | undefined) ??
    null
  );
}
