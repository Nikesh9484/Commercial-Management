import { getDb } from "../db";
import { CLOSED_STATUSES } from "../registers/defs/changes";
import { changeFeeds } from "../cost-report/feeds";

export const MATRIX_STAGES = [
  { prefix: "rfc", label: "RFC" },
  { prefix: "pvo", label: "PVO" },
  { prefix: "vo", label: "VO" },
  { prefix: "dvo", label: "DVO" },
] as const;

export const MATRIX_STATUSES = ["Cancelled", "Approved", "Pending", "Superseded", "Transferred", "Review Complete"] as const;

export interface ChangeSummary {
  matrix: { stage: string; counts: Record<string, number>; other: number; total: number }[];
  columnTotals: Record<string, number>;
  otherTotal: number;
  grandTotal: number;
  changes: number;
  open: number;
  overdue30: number;
  overdue60: number;
  costReport: { dvo: number; pvo: number; rfc: number; unlinked: number };
}

/** Status matrix + headline numbers for the tracker page. */
export function getChangeSummary(programmeId: number): ChangeSummary {
  const db = getDb();
  const matrix = MATRIX_STAGES.map((stage) => {
    const rows = db
      .prepare(`SELECT s.name AS status, COUNT(*) AS n FROM changes c JOIN approval_statuses s ON s.id = c.${stage.prefix}_status_id WHERE c.programme_id = ? GROUP BY s.name`)
      .all(programmeId) as { status: string; n: number }[];
    const counts: Record<string, number> = Object.fromEntries(MATRIX_STATUSES.map((s) => [s, 0]));
    let other = 0;
    for (const r of rows) {
      if (r.status in counts) counts[r.status] += r.n;
      else other += r.n;
    }
    const total = rows.reduce((t, r) => t + r.n, 0);
    return { stage: stage.label, counts, other, total };
  });
  const columnTotals: Record<string, number> = Object.fromEntries(MATRIX_STATUSES.map((s) => [s, matrix.reduce((t, m) => t + m.counts[s], 0)]));
  const otherTotal = matrix.reduce((t, m) => t + m.other, 0);
  const grandTotal = matrix.reduce((t, m) => t + m.total, 0);

  const all = db
    .prepare(
      `SELECT c.date_raised, c.dvo_closed, (SELECT name FROM approval_statuses WHERE id = c.overall_status_id) AS overall, c.cost_line_id
       FROM changes c WHERE c.programme_id = ?`,
    )
    .all(programmeId) as { date_raised: string | null; dvo_closed: number | null; overall: string | null; cost_line_id: number | null }[];
  const today = Date.now();
  let open = 0;
  let overdue30 = 0;
  let overdue60 = 0;
  let unlinked = 0;
  for (const c of all) {
    const closed = c.dvo_closed === 1 || CLOSED_STATUSES.includes(c.overall ?? "");
    if (!c.cost_line_id) unlinked++;
    if (closed) continue;
    open++;
    if (c.date_raised) {
      const days = Math.round((today - new Date(`${c.date_raised}T00:00:00Z`).getTime()) / 86400000);
      if (days > 60) overdue60++;
      else if (days > 30) overdue30++;
    }
  }
  const feeds = changeFeeds(db, programmeId);
  const sum = (m: Map<number, number>) => [...m.values()].reduce((t, v) => t + v, 0);
  return {
    matrix,
    columnTotals,
    otherTotal,
    grandTotal,
    changes: all.length,
    open,
    overdue30,
    overdue60,
    costReport: { dvo: sum(feeds.dvo), pvo: sum(feeds.pvo), rfc: sum(feeds.rfc), unlinked },
  };
}
