import type { RecordRow, RegisterDef } from "./types";
import { todayIso } from "../format";
import { daysBetween } from "./enrich-utils";
import { computeContracts, mergeComputed } from "../payments/compute";
import { resolveTransfers } from "../budget-transfers/compute";
import { CHANGE_STAGES, CLOSED_STATUSES } from "./defs/changes";
import { CLAIM_TYPES, NOTICE_LIMIT_DAYS, DETAIL_LIMIT_DAYS, claimCostReportAmount } from "./defs/claims";
import { businessDaysBetween } from "../workdays";
import { PROBABILITY_BANDS, IMPACT_BANDS, bandIndex, severity } from "./defs/risks";
import { EXPIRY_AMBER_DAYS, EXPIRY_RED_DAYS } from "./defs/bonds";
import { revisedContractValues } from "../bonds/revised";
import { closedContracts, contractorKey, type ClosedContracts } from "../bonds/closed";
import { getDb, getSetting } from "../db";
import { computeCostReport } from "../cost-report/compute";
import { FA_AMBER_DAYS } from "./defs/final-accounts";

/**
 * Fills in the calculated ("virtual") columns of a register after its rows are read.
 * A `<key>__tone` value of "amber" / "red" / "green" colours the cell in tables.
 */
export function enrichRows(def: RegisterDef, rows: RecordRow[]) {
  if (def.key === "changes") rows.forEach(enrichChange);
  // A change or a claim on a contract whose final account is signed (or not required) is history: the
  // same rule the bonds use, so "pending" never means an item on a contract that is already finished.
  if ((def.key === "changes" || def.key === "claims") && rows.length) {
    const closed = closedContracts(getDb(), Number(rows[0].programme_id));
    for (const r of rows) markContractClosed(r, closed);
  }
  if (def.key === "claims") rows.forEach(enrichClaim);
  if (def.key === "risks") rows.forEach(enrichRisk);
  if (def.key === "provisional_sums") rows.forEach(enrichProvisionalSum);
  if ((def.key === "contracts" || def.key === "payment_applications") && rows.length) {
    // The rows can span projects (a report's stored copy is taken across all of them), and the payment
    // calculations belong to one project at a time: each project's rows are calculated on their own,
    // otherwise only the first project's rows came out with values and the others showed zero.
    const byProgramme = new Map<number, RecordRow[]>();
    for (const r of rows) {
      const p = Number(r.programme_id);
      const group = byProgramme.get(p);
      if (group) group.push(r);
      else byProgramme.set(p, [r]);
    }
    for (const [programmeId, group] of byProgramme) mergeComputed(def.key, group, computeContracts(getDb(), programmeId));
  }
  if (def.key === "actions") {
    const today = todayIso();
    for (const r of rows) {
      const due = r.due_date as string | null;
      if (due && r.status !== "Closed") {
        const d = daysBetween(today, due);
        r.days_to_due = d;
        r.days_to_due__tone = d < 0 ? "red" : d <= 7 ? "amber" : null;
        r.__row_tone = d < 0 ? "red" : null;
      } else {
        r.days_to_due = null;
        r.days_to_due__tone = null;
        r.__row_tone = null;
      }
    }
  }
  if (def.key === "budget_transfers" && rows.length) {
    const resolved = new Map(resolveTransfers(getDb(), Number(rows[0].programme_id)).map((t) => [t.id, t]));
    for (const r of rows) {
      const t = resolved.get(r.id);
      if (!t) continue;
      r.applied = t.problem ? (r.status === "Approved" ? `No – ${t.problem}` : "No") : "Yes";
      r.applied__tone = t.problem ? (r.status === "Approved" ? "red" : null) : "green";
    }
  }
  if (def.key === "bonds" && rows.length) {
    const programmeId = Number(rows[0].programme_id);
    const revised = revisedContractValues(getDb(), programmeId);
    const closed = closedContracts(getDb(), programmeId);
    // A bond / policy is superseded when a newer one of the same type exists for the same contractor and contract.
    const latest = new Map<string, string>();
    const groupKey = (r: RecordRow) => `${r.contractor_id}|${r.cost_line_id ?? r.package_id ?? ""}|${r.type_id}`;
    for (const r of rows) {
      const k = groupKey(r);
      const e = String(r.expiry_date ?? "");
      if (e && e > (latest.get(k) ?? "")) latest.set(k, e);
    }
    rows.forEach((r) => enrichBond(r, revised.values, closed, !!r.expiry_date && String(r.expiry_date) < (latest.get(groupKey(r)) ?? "")));
  }
  if (def.key === "final_accounts" && rows.length) {
    const db = getDb();
    const programmeId = Number(rows[0].programme_id);
    const periodId = Number(getSetting(db, "current_period_id") ?? 0) || null;
    const report = computeCostReport(programmeId, periodId);
    const byLine = new Map(report.lines.map((l) => [l.id, l]));
    const today = todayIso();
    for (const r of rows) {
      const line = byLine.get(Number(r.cost_line_id));
      r.committed = line ? line.I : null;
      r.afa = line ? line.N : null;
      r.uncommitted = line ? Math.round((line.N - line.I) * 100) / 100 : null;
      const open = r.status === "Open";
      const days = open && r.forecast_closure_date ? daysBetween(today, String(r.forecast_closure_date)) : null;
      r.days_remaining = days;
      r.days_remaining__tone = days === null ? null : days < 0 ? "red" : days <= FA_AMBER_DAYS ? "amber" : "green";
      r.status__tone = r.status === "Closed" ? "green" : open ? (days !== null && days < 0 ? "red" : "amber") : null;
    }
  }
}

export { daysBetween };

/** True when a stage has anything recorded against it. */
export function stageHasData(row: RecordRow, prefix: string): boolean {
  return [`${prefix}_ref`, `${prefix}_date`, `${prefix}_status_id`, `${prefix}_tracker_amount`, `${prefix}_cr_amount`].some((k) => row[k] !== null && row[k] !== undefined && row[k] !== "");
}

/**
 * Flags a row whose contract is finished, by the cost report line it feeds, or – when it has no line –
 * by the contractor having no open contract left. Same source of truth as the bonds: the Final Account
 * Status register first, then Payment Tracking for contracts with no final account row.
 */
function markContractClosed(row: RecordRow, closed: ClosedContracts) {
  const lineId = row.cost_line_id === null || row.cost_line_id === undefined ? null : Number(row.cost_line_id);
  const byLine = lineId !== null && closed.lines.has(lineId);
  const byContractor = lineId === null && row.contractor_id !== null && row.contractor_id !== undefined && closed.contractors.has(Number(row.contractor_id));
  row.contract_closed = byLine || byContractor;
  row.contract_closed_reason = byLine ? "The final account for this cost report line is closed" : byContractor ? "Every contract of this contractor is closed" : null;
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

function complies(days: number | null, limit: number): { value: string | null; tone: string | null } {
  if (days === null) return { value: null, tone: null };
  return days <= limit ? { value: "Yes", tone: "green" } : { value: "No", tone: "red" };
}

function enrichClaim(row: RecordRow) {
  row.claim_types = CLAIM_TYPES.filter((t) => row[t.key] === true)
    .map((t) => (t.key === "type_other" && row.type_other_text ? `Other: ${row.type_other_text}` : t.label))
    .join(", ") || null;

  const a = row.notice_aware_date as string | null;
  const b = row.notice_received_date as string | null;
  const c = row.detail_received_date as string | null;
  const ab = a && b ? businessDaysBetween(a, b) : null;
  const ac = a && c ? businessDaysBetween(a, c) : null;
  row.notice_business_days = ab;
  const n = complies(ab, NOTICE_LIMIT_DAYS);
  row.notice_complies = n.value;
  row.notice_complies__tone = n.tone;
  row.detail_business_days = ac;
  const d = complies(ac, DETAIL_LIMIT_DAYS);
  row.detail_complies = d.value;
  row.detail_complies__tone = d.tone;

  row.contractor_eot_days_view = row.contractor_eot_days ?? null;
  row.determination_eot_days_view = row.determination_eot_days ?? null;
  row.contractor_cost_view = row.contractor_cost ?? null;
  row.determination_cost_view = row.determination_cost ?? null;
  row.cost_report_amount = claimCostReportAmount(row);
}

function enrichRisk(row: RecordRow) {
  const prob = row.probability === null || row.probability === undefined ? null : Number(row.probability);
  const impact = row.cost_impact === null || row.cost_impact === undefined ? null : Number(row.cost_impact);
  row.expected_value = prob !== null && impact !== null ? Math.round((prob / 100) * impact * 100) / 100 : null;
  if (prob !== null && impact !== null) {
    const rating = severity(bandIndex(prob, PROBABILITY_BANDS), bandIndex(impact, IMPACT_BANDS));
    row.rating = rating;
    row.rating__tone = rating === "High" ? "red" : rating === "Medium" ? "amber" : "green";
  } else {
    row.rating = null;
    row.rating__tone = null;
  }
}

function enrichProvisionalSum(row: RecordRow) {
  const budget = row.budget === null || row.budget === undefined ? null : Number(row.budget);
  const value = row.contract_value === null || row.contract_value === undefined ? null : Number(row.contract_value);
  if (budget === null || value === null) {
    row.saving_extra = null;
    row.saving_extra__tone = null;
    return;
  }
  const diff = Math.round((value - budget) * 100) / 100;
  row.saving_extra = diff;
  row.saving_extra__tone = diff > 0.004 ? "red" : diff < -0.004 ? "green" : null;
}

function enrichBond(row: RecordRow, revised: Map<number, number>, closed: ClosedContracts, superseded: boolean) {
  const lineIdRaw = row.cost_line_id === null || row.cost_line_id === undefined ? null : Number(row.cost_line_id);
  // Worked out in order of how sure it is. A cost line the Final Account Status and Payment Tracking
  // both say nothing about is unknown, not open, so the bond falls back to its contractor rather than
  // being reported as live on the strength of a line nobody has recorded a status for. The contractor
  // is matched by name as well as by id, because the same company entered twice under slightly
  // different spellings is still one company and its closure has to reach both sets of bonds.
  const byLine = lineIdRaw !== null && closed.lines.has(lineIdRaw);
  const lineKnown = lineIdRaw !== null && closed.knownLines.has(lineIdRaw);
  const byContractor =
    !byLine &&
    !lineKnown &&
    (closed.contractors.has(Number(row.contractor_id)) || closed.contractorNames.has(contractorKey(row.contractor_id__label)));
  const released = row.contract_closed === true || byLine || byContractor;
  row.contract_closed_reason = released
    ? row.contract_closed === true
      ? "Ticked on the row"
      : byLine
        ? "Final Account Status / Payment Tracking: contract closed"
        : "Every contract of this contractor is closed"
    : null;
  // says why a bond is still being chased, so a missing link can be found and fixed
  row.link_note = released ? null : lineIdRaw === null ? "No cost report line linked, and this contractor still has an open contract." : lineKnown ? null : "The cost report line linked here is not in the Final Account Status or Payment Tracking.";
  row.released = released || superseded;
  row.superseded = superseded && !released;
  const lineId = row.cost_line_id === null || row.cost_line_id === undefined ? null : Number(row.cost_line_id);
  const rev = lineId !== null ? (revised.get(lineId) ?? null) : null;
  row.revised_contract_value = rev;
  const original = row.original_contract_sum === null || row.original_contract_sum === undefined ? null : Number(row.original_contract_sum);
  const base = rev ?? original;
  const reqValue = row.requirement_value === null || row.requirement_value === undefined ? null : Number(row.requirement_value);
  let required: number | null = null;
  if (reqValue !== null) {
    if (row.requirement_type === "Fixed SAR amount") required = reqValue;
    else if (base !== null) required = Math.round((reqValue / 100) * base * 100) / 100;
  }
  row.required_amount = required;
  const provided = row.amount_provided === null || row.amount_provided === undefined ? null : Number(row.amount_provided);
  if (required !== null && provided !== null) {
    const v = Math.round((provided - required) * 100) / 100;
    row.variance = v;
    row.variance__tone = v < -0.004 ? "red" : null;
  } else {
    row.variance = null;
    row.variance__tone = null;
  }
  const expiry = row.expiry_date as string | null;
  if (expiry) {
    const days = daysBetween(todayIso(), expiry);
    row.days_to_expiry = days;
    const tone = released || superseded ? null : days <= EXPIRY_RED_DAYS ? "red" : days <= EXPIRY_AMBER_DAYS ? "amber" : null;
    row.days_to_expiry__tone = tone;
    row.__row_tone = tone;
    row.status = released ? "Released (contract closed)" : superseded ? "Superseded (newer policy held)" : days < 0 ? "Expired" : days <= EXPIRY_AMBER_DAYS ? "Expiring" : "Active";
    row.status__tone = released || superseded ? "grey" : days < 0 ? "red" : days <= EXPIRY_AMBER_DAYS ? "amber" : "green";
  } else {
    row.days_to_expiry = null;
    row.days_to_expiry__tone = null;
    row.__row_tone = null;
    row.status = released ? "Released (contract closed)" : "Active";
    row.status__tone = released ? "grey" : "green";
  }
}
