import type Database from "better-sqlite3";
import { computeCostReport, type CostReport } from "../cost-report/compute";
import { paymentTimeline } from "../payments/compute";
import { getRegisterDef } from "../registers";
import { listRecords } from "../registers/engine";
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
  const payments = paymentTimeline(db, programmeId);

  const openStages = CHANGE_STAGES.filter((s) => ["rfc", "pvo", "vo", "dvo"].includes(s.prefix)).map((s) => {
    const n = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM changes c JOIN approval_statuses st ON st.id = c.${s.prefix}_status_id WHERE c.programme_id = ? AND st.name IN (${OPEN_STAGE_STATUSES.map(() => "?").join(",")})`)
        .get(programmeId, ...OPEN_STAGE_STATUSES) as { n: number }
    ).n;
    return { stage: s.short, open: n };
  });
  const changes = listRecords(getRegisterDef("changes")!);
  const claims = listRecords(getRegisterDef("claims")!);
  const ews = listRecords(getRegisterDef("early_warnings")!);
  const risks = listRecords(getRegisterDef("risks")!);
  const bonds = getBondsSummary(listRecords(getRegisterDef("bonds")!));
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
