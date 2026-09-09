import type { RecordRow, RegisterDef } from "./types";
import { todayIso, toDate } from "../format";
import { CHANGE_STAGES, CLOSED_STATUSES } from "./defs/changes";

/**
 * Fills in the calculated ("virtual") columns of a register after its rows are read.
 * A `<key>__tone` value of "amber" / "red" / "green" colours the cell in tables.
 */
export function enrichRows(def: RegisterDef, rows: RecordRow[]) {
  if (def.key === "changes") rows.forEach(enrichChange);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = toDate(fromIso);
  const b = toDate(toIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** True when a stage has anything recorded against it. */
export function stageHasData(row: RecordRow, prefix: string): boolean {
  return [`${prefix}_ref`, `${prefix}_date`, `${prefix}_status_id`, `${prefix}_tracker_amount`, `${prefix}_cr_amount`].some((k) => row[k] !== null && row[k] !== undefined && row[k] !== "");
}

function enrichChange(row: RecordRow) {
  const today = todayIso();

  // Current stage = the furthest stage with anything recorded (Funding counts when any funding amount is entered).
  let current = "Not started";
  for (const s of CHANGE_STAGES) if (stageHasData(row, s.prefix)) current = s.label;
  if (["funding_btr", "funding_pvo", "funding_dvo", "funding_po", "funding_pr", "funding_contingency"].some((k) => row[k] !== null && row[k] !== undefined)) current = "Funding";
  row.current_stage = current;

  // Closed?
  const overall = String(row.overall_status_id__label ?? "");
  const closed = row.dvo_closed === true || CLOSED_STATUSES.includes(overall);
  row.is_closed = closed;

  // Days open
  const raised = row.date_raised as string | null;
  if (raised) {
    const end = closed ? ((row.closed_date as string | null) ?? String(row.updated_at ?? today).slice(0, 10)) : today;
    const days = Math.max(0, daysBetween(raised, end));
    row.days_open = days;
    row.days_open__tone = closed ? null : days > 60 ? "red" : days > 30 ? "amber" : null;
  } else {
    row.days_open = null;
    row.days_open__tone = null;
  }

  // DVO remaining days to close
  const deadline = row.dvo_deadline as string | null;
  if (deadline && row.dvo_closed !== true) {
    const rem = daysBetween(today, deadline);
    row.dvo_remaining_days = rem;
    row.dvo_remaining_days__tone = rem < 0 ? "red" : rem <= 7 ? "amber" : null;
  } else {
    row.dvo_remaining_days = null;
    row.dvo_remaining_days__tone = null;
  }
}
