import type Database from "better-sqlite3";
import { computeCostReport, type CostReport } from "../cost-report/compute";
import { paymentTimeline } from "../payments/compute";
import { getRegisterDef } from "../registers";
import { listRecords } from "../registers/engine";
import { recordsForView, paymentSourceForView } from "../view-mode";
import type { ContractRow, ApplicationRow } from "../payments/compute";
import { getBondsSummary, type BondsSummary } from "../bonds/summary";
import { getChecklist } from "../checklist";
import { CHANGE_STAGES } from "../registers/defs/changes";
import type { RecordRow } from "../registers/types";

export interface DashboardData {
  report: CostReport;
  payments: { date: string; claimed: number; certified: number; paid: number }[];
  openStages: { stage: string; open: number }[];
  openChanges: number;
  openClaims: number;
  claimsPendingValue: number;
  openEarlyWarnings: number;
  ewOpenValue: number;
  bonds: BondsSummary;
  openRisks: number;
  checklist: { done: number; total: number };
  keyIssues: string;
  actions: RecordRow[];
}

const OPEN_STAGE_STATUSES = ["Pending", "Revised & Re-submit"];

export function getDashboard(db: Database.Database, programmeId: number, periodId: number | null): DashboardData {
  const report = computeCostReport(programmeId, periodId);
  // every figure follows the top-bar period: the stored copy of an earlier / locked report, else live
  const payments = paymentTimeline(db, programmeId, undefined, paymentSourceForView<ContractRow, ApplicationRow>(db, programmeId));

  const changes = recordsForView(getRegisterDef("changes")!);
  const openStages = CHANGE_STAGES.filter((s) => ["rfc", "pvo", "vo", "dvo"].includes(s.prefix)).map((s) => ({
    stage: s.short,
    open: changes.filter((c) => OPEN_STAGE_STATUSES.includes(String(c[`${s.prefix}_status_id__label`] ?? ""))).length,
  }));
  const claims = recordsForView(getRegisterDef("claims")!);
  const ews = recordsForView(getRegisterDef("early_warnings")!);
  const risks = recordsForView(getRegisterDef("risks")!);
  const bonds = getBondsSummary(recordsForView(getRegisterDef("bonds")!));
  const actions = listRecords(getRegisterDef("actions")!)
    .filter((a) => a.status !== "Closed")
    .sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const period = periodId ? (db.prepare("SELECT key_issues FROM reporting_periods WHERE id = ?").get(periodId) as { key_issues: string | null } | undefined) : undefined;
  const checklist = periodId ? getChecklist(periodId) : [];

  return {
    report,
    payments,
    openStages,
    openChanges: changes.filter((c) => c.is_closed !== true).length,
    openClaims: claims.filter((c) => c.status === "Pending").length,
    claimsPendingValue: claims.filter((c) => c.status === "Pending").reduce((t, c) => t + num(c.contractor_cost), 0),
    openEarlyWarnings: ews.filter((e) => e.status === "Open").length,
    ewOpenValue: ews.filter((e) => e.status === "Open").reduce((t, e) => t + num(e.cost_impact), 0),
    bonds,
    openRisks: risks.filter((r) => r.type === "Risk" && (r.status === "Open" || r.status === "Mitigating")).length,
    checklist: { done: checklist.filter((c) => c.done).length, total: checklist.length },
    keyIssues: period?.key_issues ?? "",
    actions,
  };
}
