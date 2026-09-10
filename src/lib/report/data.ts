import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { listRecords } from "../registers/engine";
import { assembleReport, computeCostReport, type CostReport, type CostLineRow } from "../cost-report/compute";
import { getCashflow, type Cashflow } from "../cashflow/compute";
import { getChecklist, type ChecklistItem } from "../checklist";
import { getDashboard, type DashboardData } from "../dashboard/summary";
import { getMovement, type Movement } from "../dashboard/movement";
import { level1Matrix, type Level1Matrix } from "../cost-report/level1";
import { getPeriod, getPreviousPeriod, type PeriodRow } from "../snapshots";
import { lookupOptions } from "../registers/engine";
import type { RecordRow, RegisterDef } from "../registers/types";
import { REPORT_SCHEDULES } from "./schedules";
import { ValidationError } from "../registers/engine";

export interface ReportData {
  generatedAt: string;
  locked: boolean;
  period: PeriodRow;
  previousPeriod: PeriodRow | null;
  programme: { id: number; code: string; name: string };
  asset: { code: string; name: string } | null;
  client: string;
  location: string;
  team: RecordRow[];
  checklist: ChecklistItem[];
  meetings: { meeting: RecordRow; carried: RecordRow[]; items: RecordRow[] }[];
  dashboard: DashboardData;
  movement: Movement | null;
  costReport: CostReport;
  /** Level 1 as on the Excel "Level 01" sheet (categories across, report lines down). */
  level1Matrix: Level1Matrix;
  cashflow: Cashflow;
  registers: Record<string, { def: RegisterDef; rows: RecordRow[] }>;
  /** Which sources came from the locked snapshot vs live data. */
  sources: Record<string, "snapshot" | "live">;
}

function snapshotRows(periodId: number, key: string): RecordRow[] | null {
  const rows = getDb().prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = ? ORDER BY record_id").all(periodId, key) as { data: string }[];
  if (!rows.length) return null;
  return rows.map((r) => JSON.parse(r.data) as RecordRow);
}

/** Everything the monthly report needs for one programme and period. Uses the locked snapshot when there is one. */
export function getReportData(programmeId: number, periodId: number): ReportData {
  const db = getDb();
  const period = getPeriod(periodId);
  if (!period) throw new ValidationError("Reporting period not found.");
  const locked = period.status === "Locked";
  const programme = db.prepare("SELECT id, code, name, client_id, location_id FROM programmes WHERE id = ?").get(programmeId) as { id: number; code: string; name: string; client_id: number | null; location_id: number | null } | undefined;
  if (!programme) throw new ValidationError("Programme not found.");
  const assetId = db.prepare("SELECT value FROM app_settings WHERE key = 'current_asset_id'").get() as { value: string } | undefined;
  const asset = assetId ? ((db.prepare("SELECT code, name FROM assets WHERE id = ? AND programme_id = ?").get(Number(assetId.value), programmeId) as { code: string; name: string } | undefined) ?? null) : null;
  const client = lookupOptions(db, "clients", true).find((c) => c.id === programme.client_id)?.label ?? "";
  const location = lookupOptions(db, "locations", true).find((c) => c.id === programme.location_id)?.label ?? "";
  const sources: ReportData["sources"] = {};

  // Registers printed in the schedules
  const registers: ReportData["registers"] = {};
  const keys = REPORT_SCHEDULES.flatMap((s) => (Array.isArray(s.register) ? s.register : s.register ? [s.register] : []));
  for (const key of keys) {
    const def = getRegisterDef(key)!;
    const snap = locked ? snapshotRows(periodId, key) : null;
    let rows = snap ?? listRecords(def);
    if (snap) rows = rows.filter((r) => Number(r.programme_id) === programmeId);
    registers[key] = { def, rows };
    sources[key] = snap ? "snapshot" : "live";
  }

  // Cost report
  const live = computeCostReport(programmeId, periodId);
  let costReport = live;
  const snapLines = locked ? (snapshotRows(periodId, "cost_report") as CostLineRow[] | null) : null;
  if (snapLines) {
    const assetIds = new Set((db.prepare("SELECT id FROM assets WHERE programme_id = ?").all(programmeId) as { id: number }[]).map((a) => a.id));
    const mine = snapLines.filter((l) => assetIds.has(l.asset_id));
    costReport = assembleReport(mine, { programme: live.programme, period: live.period, previousPeriod: live.previousPeriod, feeds: live.feeds });
    sources.cost_report = "snapshot";
  } else sources.cost_report = "live";

  // Cash flow
  let cashflow = getCashflow(db, programmeId);
  const cfSnap = locked ? (db.prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = 'cashflow' AND record_id = ?").get(periodId, programmeId) as { data: string } | undefined) : undefined;
  if (cfSnap) {
    cashflow = JSON.parse(cfSnap.data) as Cashflow;
    sources.cashflow = "snapshot";
  } else sources.cashflow = "live";

  // Minutes for the period (meetings tagged with the period, else meetings dated up to the cut-off within the period)
  const meetingsDef = getRegisterDef("meetings")!;
  const actionsDef = getRegisterDef("actions")!;
  const allMeetings = listRecords(meetingsDef);
  const allItems = listRecords(actionsDef);
  let periodMeetings = allMeetings.filter((m) => Number(m.period_id) === periodId);
  if (!periodMeetings.length) {
    periodMeetings = allMeetings.filter((m) => String(m.meeting_date) <= period.period_end && (!period.period_start || String(m.meeting_date) >= period.period_start));
  }
  const meetings = periodMeetings
    .sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)))
    .map((meeting) => {
      const earlier = allMeetings.filter((m) => String(m.meeting_date) < String(meeting.meeting_date) || (String(m.meeting_date) === String(meeting.meeting_date) && m.id < meeting.id)).map((m) => m.id);
      return {
        meeting,
        carried: allItems.filter((i) => earlier.includes(Number(i.meeting_id)) && i.status !== "Closed"),
        items: allItems.filter((i) => Number(i.meeting_id) === meeting.id),
      };
    });

  const movement = getMovement(db, programmeId, periodId);
  const prevReport = movement?.previous ? computeCostReport(programmeId, movement.previous.id) : null;

  return {
    generatedAt: new Date().toISOString(),
    locked,
    period,
    previousPeriod: getPreviousPeriod(period),
    programme: { id: programme.id, code: programme.code, name: programme.name },
    asset,
    client,
    location,
    team: listRecords(getRegisterDef("project_team")!),
    checklist: getChecklist(periodId),
    meetings,
    dashboard: getDashboard(db, programmeId, periodId),
    movement,
    costReport,
    level1Matrix: level1Matrix(costReport, prevReport, movement?.keyMovements ?? null),
    cashflow,
    registers,
    sources,
  };
}
