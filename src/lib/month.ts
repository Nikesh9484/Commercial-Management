import type Database from "better-sqlite3";
import { getDb, setSetting } from "./db";
import { getRegisterDef } from "./registers";
import { createRecord, ValidationError } from "./registers/engine";
import { getChecklist } from "./checklist";
import { listPeriods, type PeriodRow } from "./snapshots";
import { logAudit } from "./audit";
import { formatMonthYear } from "./format";
import { AuthError } from "./auth";
import type { UserInfo } from "./registers/types";

/**
 * Starting a month by hand (no Excel): the next report number and month-end are proposed from the
 * last period, the period is created, made current and given its checklist. Everything the month
 * needs is then typed into the normal modules; the reports are produced from those registers exactly
 * as they are for an imported month.
 */
export interface PeriodProposal {
  report_no: number;
  period_start: string;
  period_end: string;
  label: string;
  previous: { id: number; label: string; status: string } | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthEnd = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0));
const monthStart = (y: number, m0: number) => new Date(Date.UTC(y, m0, 1));

export function labelFor(reportNo: number, periodEnd: string): string {
  return `Monthly Report No ${reportNo} – ${formatMonthYear(periodEnd)}`;
}

export function proposeNextPeriod(): PeriodProposal {
  const periods = listPeriods();
  const last = periods[0] ?? null;
  let y: number;
  let m0: number;
  if (last) {
    const d = new Date(last.period_end + "T00:00:00Z");
    y = d.getUTCFullYear();
    m0 = d.getUTCMonth() + 1;
  } else {
    const now = new Date();
    y = now.getUTCFullYear();
    m0 = now.getUTCMonth();
  }
  const end = monthEnd(y, m0);
  const start = monthStart(y, m0);
  const report_no = (last?.report_no ?? 0) + 1;
  return { report_no, period_start: iso(start), period_end: iso(end), label: labelFor(report_no, iso(end)), previous: last ? { id: last.id, label: last.label, status: last.status } : null };
}

export function startPeriod(input: { report_no: number; period_end: string }, user: UserInfo): PeriodRow {
  if (user.role !== "admin" && user.role !== "editor") throw new AuthError("Only Editors and Admins can start a new monthly report.");
  const db = getDb();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(input.period_end) ? input.period_end : null;
  if (!end) throw new ValidationError("Choose the cut-off date (month end).");
  if (!Number.isInteger(input.report_no) || input.report_no <= 0) throw new ValidationError("Enter the report number.");
  const d = new Date(end + "T00:00:00Z");
  const start = iso(monthStart(d.getUTCFullYear(), d.getUTCMonth()));
  const row = createRecord(getRegisterDef("reporting_periods")!, { report_no: input.report_no, period_start: start, period_end: end, label: labelFor(input.report_no, end), status: "Open" }, user);
  setSetting(db, "current_period_id", String(row.id));
  getChecklist(row.id);
  logAudit(db, { registerKey: "reporting_periods", recordId: row.id, action: "context", user, summary: `Started ${labelFor(input.report_no, end)} for manual entry` });
  return row as unknown as PeriodRow;
}

/** Steps of a manual month, in the order they are best done, with the registers each one touches. */
export const MONTH_STEPS: { module_no: number; title: string; href: string; registers: string[]; what: string; feeds?: string }[] = [
  { module_no: 10, title: "Budget transfers", href: "/modules/budget-transfers", registers: ["budget_transfers"], what: "Record the budget transfers approved this month.", feeds: "F" },
  { module_no: 2, title: "Cost report lines", href: "/modules/cost-report?tab=setup", registers: ["cost_lines"], what: "Add a line for any new contract or package; existing lines carry forward automatically.", feeds: "E–S" },
  { module_no: 3, title: "Change management", href: "/modules/change-management", registers: ["changes"], what: "New RFCs, PVOs that became VOs or DVOs, revised amounts and statuses.", feeds: "H, J, K" },
  { module_no: 5, title: "Early warnings & risks", href: "/modules/early-warnings", registers: ["early_warnings", "risks"], what: "Raise new early warnings; close or convert the ones that became changes.", feeds: "L" },
  { module_no: 4, title: "Claims & disputes", href: "/modules/claims-disputes", registers: ["claims"], what: "New claims, assessments received and determinations issued.", feeds: "M" },
  { module_no: 6, title: "Provisional sums", href: "/modules/provisional-sums", registers: ["provisional_sums"], what: "Instructions issued and expenditure against each provisional sum." },
  { module_no: 7, title: "Bonds & insurance", href: "/modules/bonds-insurance", registers: ["bonds"], what: "New or renewed certificates and their expiry dates." },
  { module_no: 8, title: "Invoices & payments", href: "/modules/invoices-payments", registers: ["contracts", "payment_applications", "final_accounts"], what: "Add this month's payment application / IPC for every live contract, and update the final account status.", feeds: "P" },
  { module_no: 9, title: "Cash flow", href: "/modules/cash-flow", registers: ["cashflow"], what: "This month's actual and the updated forecast." },
  { module_no: 11, title: "Minutes, actions and key issues", href: "/", registers: ["meetings", "actions"], what: "Minutes of the commercial meeting, open actions, and the Key issues text on the Executive Summary." },
  { module_no: 1, title: "Report control", href: "/modules/project-setup", registers: ["reporting_periods", "project_team"], what: "Prepared / reviewed / approved by, Aconex reference, distribution list." },
];

/** How many rows of each register were added, changed or imported since the period started. */
export function monthActivity(db: Database.Database, period: PeriodRow): Record<string, number> {
  const since = period.period_start ?? period.created_at ?? period.period_end;
  const rows = db.prepare("SELECT register_key AS k, COUNT(*) AS n FROM audit_log WHERE at >= ? AND action IN ('create','update','import') GROUP BY register_key").all(String(since)) as { k: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}
