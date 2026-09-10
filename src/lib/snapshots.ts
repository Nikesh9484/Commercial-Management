import { getDb, getSetting, setSetting } from "./db";
import { allRegisters } from "./registers";
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
export function lockPeriod(periodId: number, user: UserInfo, opts: { force?: boolean } = {}): { registers: number; records: number } {
  if (user.role !== "admin") throw new AuthError("Only an Admin can lock a reporting period.");
  const db = getDb();
  const period = getPeriod(periodId);
  if (!period) throw new ValidationError("Reporting period not found.");
  // A snapshot freezes the LIVE registers. Locking an older month while a newer one exists would
  // store the newer month's figures under the older report (and the movement between them shows 0).
  const newer = db.prepare("SELECT label FROM reporting_periods WHERE report_no > ? ORDER BY report_no").all(period.report_no) as { label: string }[];
  if (newer.length && !opts.force) {
    throw new ValidationError(
      `${newer[0].label} already exists, so the live figures are probably that month's, not ${period.label}'s. Locking now would freeze them as ${period.label} and the movement between the two reports would show 0. Lock reports in date order: import or enter ${period.label}, lock it, then load the newer month. Lock anyway only if you are sure the live figures are ${period.label}'s.`,
      { force: "confirm" },
    );
  }
  const stamp = nowIso();
  let registers = 0;
  let records = 0;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM snapshots WHERE period_id = ?").run(periodId);
    const ins = db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, ?, ?, ?, ?)");
    for (const def of allRegisters) {
      if (!def.snapshot) continue;
      registers++;
      for (const row of listRecords(def)) {
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
    db.prepare("UPDATE reporting_periods SET status = 'Locked', locked_at = ?, locked_by = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(
      todayIso(),
      user.name,
      stamp,
      user.name,
      periodId,
    );
  });
  tx();
  logAudit(db, {
    registerKey: "reporting_periods",
    recordId: periodId,
    action: "lock",
    user,
    summary: `Locked ${period.label} (snapshot of ${records} record(s) across ${registers} register(s))`,
    changes: { status: { from: "Open", to: "Locked" } },
  });
  return { registers, records };
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
    summary: `Unlocked ${period.label} (the stored snapshot is kept until the period is locked again)`,
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
