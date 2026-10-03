import type { RecordRow, RegisterDef } from "./types";
import { todayIso } from "../format";
import { daysBetween } from "./enrich-utils";
import { computeContracts, mergeComputed } from "../payments/compute";
import { columnFSource, resolveTransfers } from "../budget-transfers/compute";
import { CHANGE_STAGES, CLOSED_STATUSES } from "./defs/changes";
import { CLAIM_TYPES, NOTICE_LIMIT_DAYS, DETAIL_LIMIT_DAYS, claimCostReportAmount } from "./defs/claims";
import { businessDaysBetween } from "../workdays";
import { PROBABILITY_BANDS, IMPACT_BANDS, bandIndex, severity } from "./defs/risks";
import { EXPIRY_AMBER_DAYS, EXPIRY_RED_DAYS } from "./defs/bonds";
import { revisedContractValues } from "../bonds/revised";
import { closedContracts, closureByName, contractorKey, type ClosedContracts } from "../bonds/closed";
import { enrichLeases } from "../leases/summary";
import { listBondDocuments } from "../bonds/documents";
import { getDb, getSetting } from "../db";
import { computeCostReport } from "../cost-report/compute";
import { FA_AMBER_DAYS } from "./defs/final-accounts";
import { latestRemark, remarksNewestFirst } from "../claims/remarks";
import { claimIsOpen } from "../claims/status";

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
  if (def.key === "lease_agreements" && rows.length) enrichLeases(rows, getDb());
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
    const programmeId = Number(rows[0].programme_id);
    const resolved = new Map(resolveTransfers(getDb(), programmeId).map((t) => [t.id, t]));
    // Column F brought forward from the Excel cost report: the log is the Schedule J record behind
    // that figure, so every approved transfer is in the cost report by definition – nothing is flagged
    // as missing. Otherwise a transfer is in column F only when both its lines resolve.
    const fromWorkbook = columnFSource(getDb(), programmeId).fromWorkbook;
    for (const r of rows) {
      const t = resolved.get(r.id);
      if (!t) continue;
      if (fromWorkbook) {
        r.applied = r.status === "Approved" ? "Yes – Schedule B column F" : `No – ${String(r.status ?? "").toLowerCase() || "not approved"}`;
        r.applied__tone = r.status === "Approved" ? "green" : null;
        continue;
      }
      r.applied = t.problem ? (r.status === "Approved" ? `No – ${t.problem}` : "No") : "Yes";
      r.applied__tone = t.problem ? (r.status === "Approved" ? "red" : null) : "green";
    }
  }
  if (def.key === "bonds" && rows.length) {
    const programmeId = Number(rows[0].programme_id);
    const docs = listBondDocuments(rows.map((r) => Number(r.id)));
    for (const r of rows) {
      const list = docs.get(Number(r.id)) ?? [];
      r.documents = list.map((d) => d.name).join("; ");
      r.__docs = list.map((d) => ({ id: d.id, name: d.name, note: d.note }));
    }
    const revised = revisedContractValues(getDb(), programmeId);
    const closed = closedContracts(getDb(), programmeId);
    // A bond / policy is superseded when a newer one of the same type exists for the same contractor and
    // contract. The contractor is keyed by name rather than by row, so the same company entered twice
    // (a second import under a slightly different spelling) does not hide its own replacement policy.
    const latest = new Map<string, string>();
    const groupKey = (r: RecordRow) => `${contractorKey(r.contractor_id__label) || String(r.contractor_id)}|${r.package_id ?? r.cost_line_id ?? ""}|${r.type_id}`;
    for (const r of rows) {
      const k = groupKey(r);
      const e = String(r.expiry_date ?? "");
      if (e && e > (latest.get(k) ?? "")) latest.set(k, e);
    }
    // The same policy entered twice - the same contractor, package, type and expiry date, which
    // happens when a register has been imported from two places - is one policy, not two. Neither
    // copy is newer than the other, so "superseded" cannot separate them: the first one recorded is
    // kept and the rest are marked as the duplicates they are, rather than being chased twice.
    const firstOfKind = new Map<string, unknown>();
    const sameKey = (r: RecordRow) => `${groupKey(r)}|${String(r.expiry_date ?? "")}|${String(r.amount_provided ?? "")}`;
    for (const r of [...rows].sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0))) {
      const k = sameKey(r);
      if (!firstOfKind.has(k)) firstOfKind.set(k, r.id);
    }
    rows.forEach((r) =>
      enrichBond(r, revised.values, closed, !!r.expiry_date && String(r.expiry_date) < (latest.get(groupKey(r)) ?? ""), firstOfKind.get(sameKey(r)) !== r.id),
    );
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
  const has = (k: string) => row[k] !== null && row[k] !== undefined && row[k] !== "";
  // a status set to "Pending" on its own (the next stages of a change just raised) does not make the stage current
  const pendingOnly = has(`${prefix}_status_id`) && String(row[`${prefix}_status_id__label`] ?? "").toLowerCase() === "pending";
  return [`${prefix}_ref`, `${prefix}_date`, `${prefix}_tracker_amount`, `${prefix}_cr_amount`].some(has) || (has(`${prefix}_status_id`) && !pendingOnly);
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

  // The tracker's Remarks (column BR) is a running log with no consistent order. It is re-ordered
  // newest first for the table, and its latest dated entry – or the tracker's "date of last action",
  // whichever is later – is when the claim was last moved.
  const today = todayIso();
  row.remarks_view = row.remark ? remarksNewestFirst(row.remark, today) || null : null;
  const latest = row.remark ? latestRemark(row.remark, today) : null;
  row.latest_remark = latest?.text ?? null;
  row.latest_remark_date = latest?.date ?? null;
  const lastAction = typeof row.last_action_date === "string" && row.last_action_date ? row.last_action_date : null;
  const update = [lastAction, latest?.date ?? null].filter((x): x is string => !!x).sort().pop() ?? null;
  row.last_update = update;
  const open = claimIsOpen(row);
  row.days_since_update = update ? Math.max(0, daysBetween(update, today)) : null;
  row.days_since_update__tone = open && update ? (Number(row.days_since_update) > 60 ? "red" : Number(row.days_since_update) > 30 ? "amber" : null) : null;
  // a claim that is still live but has never had a word written against it is itself a finding
  row.no_update = open && !update && !row.remark;
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

function enrichBond(row: RecordRow, revised: Map<number, number>, closed: ClosedContracts, superseded: boolean, duplicate: boolean) {
  const lineIdRaw = row.cost_line_id === null || row.cost_line_id === undefined ? null : Number(row.cost_line_id);
  const pkgIdRaw = row.package_id === null || row.package_id === undefined ? null : Number(row.package_id);
  // A bond is live only while it can be tied to a contract the registers say is open. The link is
  // read in order of how sure it is: the cost report line, then the package (a number on both rows,
  // so it holds when two spellings of a company are nothing alike), then the contractor (by row and
  // by squashed name, so "Co. Ltd." and "Co.Ltd." are one company). A bond that cannot be tied to
  // any open contract is treated as closed: nothing is chased on the strength of a contract nobody
  // has recorded as open.
  const lineKnown = lineIdRaw !== null && closed.knownLines.has(lineIdRaw);
  const pkgKnown = pkgIdRaw !== null && closed.knownPackages.has(pkgIdRaw);
  const nameKey = contractorKey(row.contractor_id__label);
  const ctrKnown = closed.knownContractors.has(Number(row.contractor_id)) || (!!nameKey && closed.knownContractorNames.has(nameKey));
  const ctrClosed = closed.contractors.has(Number(row.contractor_id)) || (!!nameKey && closed.contractorNames.has(nameKey));
  let released: boolean;
  let reason: string | null = null;
  let note: string | null = null;
  let byName: boolean | null = null;
  if (row.contract_closed === true) {
    released = true;
    reason = "Ticked on the row";
  } else if (lineKnown) {
    released = closed.lines.has(lineIdRaw!);
    reason = released ? "Final Account Status / Payment Tracking: contract closed" : null;
    note = released ? null : "The contract on this cost report line is open.";
  } else if (pkgKnown) {
    released = closed.packages.has(pkgIdRaw!);
    reason = released ? "Every contract of this package is closed" : null;
    note = released ? null : "This package still has an open contract.";
  } else if ((byName = closureByName(closed, row.package_id__label)) !== null) {
    // a package of the bond's own ("Marina Basin") tied to the contract its words belong to ("Al Saad-Marina Basin")
    released = byName;
    reason = released ? "The contract this package belongs to is closed" : null;
    note = released ? null : "The contract this package belongs to is open.";
  } else if (ctrKnown) {
    released = ctrClosed;
    reason = released ? "Every contract of this contractor is closed" : null;
    note = released ? null : "This contractor still has an open contract.";
  } else {
    released = true;
    reason = "No open contract is recorded for this bond's cost report line, package or contractor";
  }
  row.contract_closed_reason = reason;
  // says why a bond is still being chased, so a missing link can be found and fixed
  row.link_note = note;
  row.released = released || superseded || duplicate;
  row.superseded = superseded && !released && !duplicate;
  row.duplicate = duplicate && !released;
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
    const tone = released || superseded || duplicate ? null : days <= EXPIRY_RED_DAYS ? "red" : days <= EXPIRY_AMBER_DAYS ? "amber" : null;
    row.days_to_expiry__tone = tone;
    row.__row_tone = tone;
    row.status = released
      ? "Released (contract closed)"
      : duplicate
        ? "Duplicate (same policy entered twice)"
        : superseded
          ? "Superseded (newer policy held)"
          : days < 0
            ? "Expired"
            : days <= EXPIRY_AMBER_DAYS
              ? "Expiring"
              : "Active";
    row.status__tone = released || superseded || duplicate ? "grey" : days < 0 ? "red" : days <= EXPIRY_AMBER_DAYS ? "amber" : "green";
  } else {
    row.days_to_expiry = null;
    row.days_to_expiry__tone = null;
    row.__row_tone = null;
    row.status = released ? "Released (contract closed)" : duplicate ? "Duplicate (same policy entered twice)" : "Active";
    row.status__tone = released || duplicate ? "grey" : "green";
  }
}
