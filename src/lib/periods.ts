import { getDb, getSetting, setSetting } from "./db";
import { getRegisterDef } from "./registers";
import { updateRecord, ValidationError } from "./registers/engine";
import { getPeriod, listPeriods, type PeriodRow } from "./snapshots";
import { logAudit } from "./audit";
import { AuthError } from "./auth";
import { formatMonthYear } from "./format";
import type { UserInfo } from "./registers/types";

/**
 * The report library: every monthly report (reporting period) with where it came from, whether it
 * is issued, and the tools to change, re-upload or delete it.
 */
export interface LibraryRow {
  id: number;
  report_no: number;
  label: string;
  period_start: string | null;
  period_end: string;
  status: "Open" | "Locked";
  locked_at: string | null;
  locked_by: string | null;
  /** "Workbook import" | "Manual entry" */
  source: string;
  source_file: string | null;
  imported_at: string | null;
  imported_by: string | null;
  /** records held in the issued snapshot (0 when open) */
  snapshot_records: number;
  cost_lines: number;
  current: boolean;
  created_at: string | null;
}

export function listReportLibrary(): LibraryRow[] {
  const db = getDb();
  const current = Number(getSetting(db, "current_period_id") ?? 0);
  const snap = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN register_key = 'cost_report' THEN 1 ELSE 0 END) AS lines FROM snapshots WHERE period_id = ?");
  const lastImport = db.prepare("SELECT at, user_name FROM audit_log WHERE register_key = 'reporting_periods' AND record_id = ? AND action = 'import' ORDER BY at DESC LIMIT 1");
  return listPeriods().map((p) => {
    const row = p as PeriodRow & { source_file?: string | null; imported_at?: string | null; imported_by?: string | null };
    const s = snap.get(p.id) as { n: number; lines: number | null };
    // periods imported before the source was recorded: fall back to the change history
    const imp = row.imported_at ? { at: row.imported_at, user_name: row.imported_by ?? null } : (lastImport.get(p.id) as { at: string; user_name: string | null } | undefined);
    return {
      id: p.id,
      report_no: p.report_no,
      label: p.label,
      period_start: p.period_start,
      period_end: p.period_end,
      status: p.status,
      locked_at: p.locked_at,
      locked_by: p.locked_by,
      source: imp ? "Workbook import" : "Manual entry",
      source_file: row.source_file ?? null,
      imported_at: imp?.at ?? null,
      imported_by: imp?.user_name ?? null,
      snapshot_records: s.n,
      cost_lines: s.lines ?? 0,
      current: p.id === current,
      created_at: (p.created_at as string | null) ?? null,
    };
  });
}

/** Change the report number, cut-off date or label. The label is rebuilt when left blank. */
export function updatePeriodDetails(id: number, input: { report_no?: unknown; period_end?: unknown; period_start?: unknown; label?: unknown }, user: UserInfo): PeriodRow {
  if (user.role !== "admin") throw new AuthError("Only an Admin can change a report's details.");
  const cur = getPeriod(id);
  if (!cur) throw new ValidationError("Report not found.");
  const patch: Record<string, unknown> = {};
  if (input.report_no !== undefined) {
    const n = Number(input.report_no);
    if (!Number.isInteger(n) || n <= 0) throw new ValidationError("Enter the report number.", { report_no: "Whole number required" });
    patch.report_no = n;
  }
  if (input.period_end !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.period_end))) throw new ValidationError("Enter the cut-off date.", { period_end: "Date required" });
    patch.period_end = String(input.period_end);
  }
  if (input.period_start !== undefined) patch.period_start = input.period_start ? String(input.period_start) : null;
  const no = (patch.report_no as number | undefined) ?? cur.report_no;
  const end = (patch.period_end as string | undefined) ?? cur.period_end;
  const label = input.label === undefined ? null : String(input.label).trim();
  patch.label = label || `Monthly Report No ${no} – ${formatMonthYear(end)}`;
  return updateRecord(getRegisterDef("reporting_periods")!, id, patch, user) as unknown as PeriodRow;
}

/** Deletes a report with its snapshot and checklist; minutes and budget transfers that pointed at it are kept, unlinked. */
export function deletePeriod(id: number, user: UserInfo): { label: string } {
  if (user.role !== "admin") throw new AuthError("Only an Admin can delete a report.");
  const db = getDb();
  const p = getPeriod(id);
  if (!p) throw new ValidationError("Report not found.");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM snapshots WHERE period_id = ?").run(id);
    db.prepare("DELETE FROM report_checklist WHERE period_id = ?").run(id);
    db.prepare("UPDATE meetings SET period_id = NULL WHERE period_id = ?").run(id);
    db.prepare("UPDATE budget_transfers SET period_id = NULL WHERE period_id = ?").run(id);
    db.prepare("DELETE FROM reporting_periods WHERE id = ?").run(id);
    if (getSetting(db, "current_period_id") === String(id)) {
      const latest = db.prepare("SELECT id FROM reporting_periods ORDER BY report_no DESC LIMIT 1").get() as { id: number } | undefined;
      setSetting(db, "current_period_id", latest ? String(latest.id) : null);
    }
  });
  tx();
  logAudit(db, { registerKey: "reporting_periods", recordId: id, action: "delete", user, summary: `Deleted ${p.label} with its snapshot and checklist` });
  return { label: p.label };
}
