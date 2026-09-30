import { getDb } from "../db";
import { getPeriod, getPreviousPeriod } from "../snapshots";
import { getReportData, type ReportData } from "../report/data";
import { buildKpi, type KpiReport } from "./model";

/** The KPI of one report, compared with the report before it. */
export function loadKpi(programmeId: number, periodId: number): { data: ReportData; previous: ReportData | null; kpi: KpiReport } {
  const data = getReportData(programmeId, periodId);
  const prev = getPreviousPeriod(getPeriod(periodId));
  const previous = prev ? getReportData(programmeId, prev.id) : null;
  const types = new Map((getDb().prepare("SELECT id, type FROM contractors").all() as { id: number; type: string | null }[]).map((r) => [r.id, r.type ?? ""]));
  const assets = new Map((getDb().prepare("SELECT id, code, name FROM assets").all() as { id: number; code: string; name: string }[]).map((r) => [r.id, { code: r.code, name: r.name }]));
  const kpi = buildKpi(data, previous, { contractorType: (id) => types.get(id) ?? "", asset: (id) => assets.get(id) });
  return { data, previous, kpi };
}
