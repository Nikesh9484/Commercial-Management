import type { RecordRow, RegisterDef } from "./types";
import { todayIso } from "../format";
import { daysBetween } from "./enrich-utils";
import { computeContracts } from "../payments/compute";
import { resolveTransfers } from "../budget-transfers/compute";
import { CHANGE_STAGES, CLOSED_STATUSES } from "./defs/changes";
import { CLAIM_TYPES, NOTICE_LIMIT_DAYS, DETAIL_LIMIT_DAYS, claimCostReportAmount } from "./defs/claims";
import { businessDaysBetween } from "../workdays";
import { PROBABILITY_BANDS, IMPACT_BANDS, bandIndex, severity } from "./defs/risks";
import { EXPIRY_AMBER_DAYS, EXPIRY_RED_DAYS } from "./defs/bonds";
import { revisedContractValues } from "../bonds/revised";
import { closedContracts, type ClosedContracts } from "../bonds/closed";
import { getDb, getSetting } from "../db";
import { computeCostReport } from "../cost-report/compute";
import { FA_AMBER_DAYS } from "./defs/final-accounts";

/**
 * Fills in the calculated ("virtual") columns of a register after its rows are read.
 * A `<key>__tone` value of "amber" / "red" / "green" colours the cell in tables.
 */
export function enrichRows(def: RegisterDef, rows: RecordRow[]) {
  if (def.key === "changes") rows.forEach(enrichChange);
  if (def.key === "claims") rows.forEach(enrichClaim);
  if (def.key === "risks") rows.forEach(enrichRisk);
  if (def.key === "provisional_sums") rows.forEach(enrichProvisionalSum);
  if ((def.key === "contracts" || def.key === "payment_applications") && rows.length) {
    const programmeId = Number(rows[0].programme_id);
    const { contracts, applications } = computeContracts(getDb(), programmeId);
    for (const r of rows) {
      const comp = def.key === "contracts" ? contracts.get(r.id) : applications.get(r.id);
      if (!comp) continue;
      const { row_tone, ...values } = comp as unknown as Record<string, unknown> & { row_tone?: string | null };
      Object.assign(r, values);
      if (def.key === "payment_applications") {
        r.__row_tone = row_tone ?? null;
        const late = (k: string) => {
          const v = r[k] as number | null;
          r[`${k}__tone`] = v === null || v === undefined ? null : v > 0 ? "red" : v < 0 ? "green" : null;
        };
        late("ipc_days_late");
        late("payment_days_late");
      } else {
        const pct = r.pct_certified as number | null;
        r.pct_certified__tone = pct === null ? null : pct >= 100 ? "green" : null;
      }
    }
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
  const released = row.contract_closed === true || (lineIdRaw !== null ? closed.lines.has(lineIdRaw) : closed.contractors.has(Number(row.contractor_id)));
  row.contract_closed_reason = released ? (row.contract_closed === true ? "Ticked on the row" : lineIdRaw !== null ? "Final Account Status / Payment Tracking: contract closed" : "All this contractor's contracts are closed") : null;
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
