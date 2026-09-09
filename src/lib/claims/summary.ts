import { getDb } from "../db";
import { ASSESSMENT_PARTIES, claimCostReportAmount } from "../registers/defs/claims";

export interface ClaimsSummary {
  total: number;
  open: number;
  byStatus: { status: string; n: number }[];
  parties: { label: string; eot: number; compensable: number; cost: number; claims: number }[];
  eotClaimed: number;
  eotGranted: number;
  costClaimed: number;
  costDetermined: number;
  costReport: number;
  unlinked: number;
  noticeLate: number;
  detailLate: number;
}

export function getClaimsSummary(programmeId: number, rows: Record<string, unknown>[]): ClaimsSummary {
  const db = getDb();
  const byStatusRows = db.prepare("SELECT status, COUNT(*) AS n FROM claims WHERE programme_id = ? GROUP BY status ORDER BY n DESC").all(programmeId) as { status: string; n: number }[];
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const parties = ASSESSMENT_PARTIES.map((p) => ({
    label: p.label,
    eot: rows.reduce((t, r) => t + num(r[`${p.prefix}_eot_days`]), 0),
    compensable: rows.reduce((t, r) => t + num(r[`${p.prefix}_compensable_days`]), 0),
    cost: rows.reduce((t, r) => t + num(r[`${p.prefix}_cost`]), 0),
    claims: rows.filter((r) => [`${p.prefix}_eot_days`, `${p.prefix}_compensable_days`, `${p.prefix}_cost`, `${p.prefix}_ref`, `${p.prefix}_date`].some((k) => r[k] !== null && r[k] !== undefined && r[k] !== "")).length,
  }));
  return {
    total: rows.length,
    open: rows.filter((r) => r.status === "Pending").length,
    byStatus: byStatusRows,
    parties,
    eotClaimed: parties[0].eot,
    eotGranted: parties[3].eot,
    costClaimed: parties[0].cost,
    costDetermined: parties[3].cost,
    costReport: rows.reduce((t, r) => t + claimCostReportAmount(r), 0),
    unlinked: rows.filter((r) => !r.cost_line_id).length,
    noticeLate: rows.filter((r) => r.notice_complies === "No").length,
    detailLate: rows.filter((r) => r.detail_complies === "No").length,
  };
}
