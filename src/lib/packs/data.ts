import { formatDate } from "../format";
import { getDb, getSetting } from "../db";
import { computeCostReport } from "../cost-report/compute";
import { todayIso } from "../format";
import type { UserInfo } from "../registers/types";
import { packType, type PackTypeKey, type PackValues } from "./shared";

/**
 * Fills a pack's fields from the registers: the change (RFC, PVO, VO, DVO, RFA), the claim (EOT
 * and Cost EAR) or the contract (Stage 2), with the programme, asset, package, contractor, contract
 * and cost report line around it. Everything stays editable on the pack afterwards.
 */

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v: unknown) => {
  const x = n(v);
  return x === null || Number.isNaN(x) ? "" : String(Math.round(x * 100) / 100);
};

export interface SourceOption {
  id: number;
  label: string;
  sub: string;
}

/** The register items a pack of this category can be started from, for the current programme. */
export function listSources(type: PackTypeKey, programmeId: number): SourceOption[] {
  const db = getDb();
  const t = packType(type)!;
  if (t.source === "changes") {
    const rows = db
      .prepare("SELECT c.id, c.item_no, c.description, c.pvo_ref, c.vo_ref, c.dvo_ref, c.rfc_ref, k.name AS contractor FROM changes c LEFT JOIN contractors k ON k.id = c.contractor_id WHERE c.programme_id = ? ORDER BY c.item_no")
      .all(programmeId) as Row[];
    return rows.map((r) => ({ id: Number(r.id), label: `${s(r.item_no)} – ${s(r.description).slice(0, 90)}`, sub: [s(r.contractor), s(r.rfc_ref), s(r.pvo_ref), s(r.vo_ref), s(r.dvo_ref)].filter(Boolean).join(" · ") }));
  }
  if (t.source === "claims") {
    const rows = db.prepare("SELECT c.id, c.claim_no, c.description, c.contract_no, c.status, k.name AS contractor FROM claims c LEFT JOIN contractors k ON k.id = c.contractor_id WHERE c.programme_id = ? ORDER BY c.claim_no").all(programmeId) as Row[];
    return rows.map((r) => ({ id: Number(r.id), label: `${s(r.claim_no)} – ${s(r.description).slice(0, 90)}`, sub: [s(r.contractor), s(r.contract_no), s(r.status)].filter(Boolean).join(" · ") }));
  }
  const rows = db.prepare("SELECT c.id, c.sr_no, c.title, c.acc_ref, c.current_status, k.name AS contractor FROM contracts c LEFT JOIN contractors k ON k.id = c.contractor_id WHERE c.programme_id = ? ORDER BY c.sr_no").all(programmeId) as Row[];
  return rows.map((r) => ({ id: Number(r.id), label: `${s(r.acc_ref) || `#${s(r.sr_no)}`} – ${s(r.title).slice(0, 90)}`, sub: [s(r.contractor), s(r.current_status)].filter(Boolean).join(" · ") }));
}

interface Surround {
  programme: Row | null;
  asset: Row | null;
  package: Row | null;
  contractor: Row | null;
  contract: Row | null;
  line: Row | null;
}

function surround(programmeId: number, ids: { asset_id?: unknown; package_id?: unknown; contractor_id?: unknown; cost_line_id?: unknown; contract_id?: unknown }): Surround {
  const db = getDb();
  const one = (sql: string, id: unknown): Row | null => (id ? ((db.prepare(sql).get(Number(id)) as Row | undefined) ?? null) : null);
  const programme = one("SELECT * FROM programmes WHERE id = ?", programmeId);
  const asset = one("SELECT * FROM assets WHERE id = ?", ids.asset_id);
  const pkg = one("SELECT * FROM packages WHERE id = ?", ids.package_id);
  const contractor = one("SELECT * FROM contractors WHERE id = ?", ids.contractor_id);
  const line = one("SELECT * FROM cost_lines WHERE id = ?", ids.cost_line_id);
  let contract = one("SELECT * FROM contracts WHERE id = ?", ids.contract_id);
  if (!contract && ids.cost_line_id) contract = one("SELECT * FROM contracts WHERE cost_line_id = ? ORDER BY id LIMIT 1", ids.cost_line_id);
  if (!contract && ids.contractor_id && ids.package_id) contract = (db.prepare("SELECT * FROM contracts WHERE programme_id = ? AND contractor_id = ? AND package_id = ? ORDER BY id LIMIT 1").get(programmeId, Number(ids.contractor_id), Number(ids.package_id)) as Row | undefined) ?? null;
  if (!contract && ids.contractor_id) contract = (db.prepare("SELECT * FROM contracts WHERE programme_id = ? AND contractor_id = ? ORDER BY id LIMIT 1").get(programmeId, Number(ids.contractor_id)) as Row | undefined) ?? null;
  return { programme, asset, package: pkg, contractor, contract, line };
}

/** "1TB01006" + "006C45" → "1TB01-006C45", as the RSG forms write the ACC contract number. */
function contractNo(programmeCode: string, accRef: string): string {
  const acc = accRef.trim();
  if (!acc) return "";
  if (/[-–]/.test(acc) || acc.length > 8) return acc;
  return `${programmeCode.slice(0, 5)}-${acc}`;
}

/** "006F01" + "006F01 – Construction Supervision Services" → the name alone when it already carries the code. */
function worksPackage(code: string, name: string): string {
  const key = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code && name && key(name).startsWith(key(code))) return name;
  return [code, name].filter(Boolean).join(" ");
}

function common(programmeId: number, sur: Surround, user: UserInfo): PackValues {
  const db = getDb();
  const code = s(sur.programme?.code);
  const name = s(sur.programme?.name);
  const team = (db.prepare("SELECT role FROM project_team WHERE programme_id = ? AND lower(name) = lower(?) LIMIT 1").get(programmeId, user.name) as { role?: string } | undefined)?.role ?? "";
  // "1TB01031" → Program 01: the RSG forms carry the programme number after the destination code, and
  // both Triple Bay projects sit under Program 01 – Marina Village
  const programNo = code.match(/^1TB(\d{2})/)?.[1] ?? code.slice(-2);
  return {
    destination: "AMAALA Destination",
    program_name: `Program ${programNo} - Marina Village`,
    program_no: programNo,
    project_name: s(sur.asset?.name) || name,
    project_code: s(sur.asset?.code) || code,
    development_name: "Triple Bay",
    development_no: "TB",
    contract_no: contractNo(code, s(sur.contract?.acc_ref) || s(sur.contractor?.acc_ref)),
    contract_title: s(sur.contract?.title) || s(sur.package?.name),
    works_package: worksPackage(s(sur.contract?.acc_ref) || s(sur.package?.code), s(sur.package?.name)),
    ewbs_code: s(sur.line?.code),
    contractor: s(sur.contractor?.name),
    contractor_rep: s(sur.contractor?.contact_name),
    requesting_department: "Commercial",
    date: todayIso(),
    prepared_by: user.name,
    prepared_position: team,
  };
}

export interface ChangeLogRow {
  description: string;
  rfc: string;
  pvo: string;
  vo: string;
  dvo: string;
  pvoValue: number | null;
  dvoValue: number | null;
  thisOne: boolean;
}

/** The change log of a contract as the RSG packs carry it: every change on the same cost report line with its RFC, PVO, VO and DVO refs and values. */
export function changeLogRows(programmeId: number, costLineId: number | null, contractorId: number | null, thisId: number | null): ChangeLogRow[] {
  const db = getDb();
  const rows = (costLineId
    ? db.prepare("SELECT * FROM changes WHERE programme_id = ? AND cost_line_id = ? ORDER BY date_raised, item_no").all(programmeId, costLineId)
    : contractorId
      ? db.prepare("SELECT * FROM changes WHERE programme_id = ? AND contractor_id = ? ORDER BY date_raised, item_no").all(programmeId, contractorId)
      : []) as Row[];
  return rows.map((r) => ({
    description: s(r.description),
    rfc: s(r.rfc_ref),
    pvo: s(r.pvo_ref),
    vo: s(r.vo_ref),
    dvo: s(r.dvo_ref) || s(r.dvo_avi_ref),
    pvoValue: n(r.pvo_tracker_amount) ?? n(r.dvo_planned_value),
    dvoValue: n(r.dvo_actual_value) ?? n(r.dvo_tracker_amount),
    thisOne: Number(r.id) === thisId,
  }));
}

export function changeLogText(rows: ChangeLogRow[]): string {
  return rows.map((r) => `${r.description} – ${[r.rfc, r.pvo, r.vo, r.dvo].map((x) => x || "-").join(" – ")} – PVO ${r.pvoValue === null ? "-" : money(r.pvoValue)} – DVO ${r.dvoValue === null ? "-" : money(r.dvoValue)}${r.thisOne ? " – (this one)" : ""}`).join("\n");
}

/** The budget position around a change: its cost report line and the budget hold of the same asset. */
function budgetPosition(programmeId: number, lineId: number | null, assetId: number | null, thisValue: number | null): PackValues {
  const out: PackValues = {};
  try {
    const periodId = getSetting(getDb(), "current_period_id");
    const report = computeCostReport(programmeId, periodId ? Number(periodId) : null);
    const line = lineId ? report.lines.find((l) => l.id === lineId) : undefined;
    if (line) {
      out.approved_contract = money(line.I - line.H);
      out.approved_dvos = money(line.H);
      out.approved_pvos = money(line.J);
      out.budget_to_line = `${line.asset_code}.${line.code}`;
    }
    // the budget hold of the same cost category (construction, professional services…) and asset, else any hold of the asset
    const holds = report.lines.filter((l) => l.is_budget_hold);
    const hold = holds.find((l) => line && l.category === line.category && (!assetId || l.asset_id === assetId)) ?? holds.find((l) => line && l.category === line.category) ?? holds.find((l) => !assetId || l.asset_id === assetId) ?? holds[0];
    if (hold) {
      const available = Math.round((hold.G - hold.H - hold.J) * 100) / 100;
      out.budget_line = `${hold.asset_code}.${hold.code}`;
      out.budget_available = money(available);
      out.remaining_budget = money(available);
      out.revised_budget = money(available - (thisValue ?? 0));
    }
  } catch {
    /* the cost report is not needed for the pack */
  }
  return out;
}

function changeValues(type: PackTypeKey, programmeId: number, id: number, user: UserInfo): { values: PackValues; ref: string; title: string } | null {
  const db = getDb();
  const c = db.prepare("SELECT * FROM changes WHERE id = ? AND programme_id = ?").get(id, programmeId) as Row | undefined;
  if (!c) return null;
  const sur = surround(programmeId, c);
  const v = common(programmeId, sur, user);
  const status = (sid: unknown) => (sid ? s((db.prepare("SELECT name FROM approval_statuses WHERE id = ?").get(Number(sid)) as { name?: string } | undefined)?.name) : "");
  const initiator = c.initiated_by_id ? s((db.prepare("SELECT name FROM change_initiators WHERE id = ?").get(Number(c.initiated_by_id)) as { name?: string } | undefined)?.name) : "";
  const title = s(c.description);
  v.item_no = s(c.item_no);
  v.title = title;
  v.rfc_ref = s(c.rfc_ref);
  v.pvo_no = s(c.pvo_ref);
  v.vo_no = s(c.vo_ref);
  v.dvo_no = s(c.dvo_avi_ref) || s(c.dvo_ref);
  v.initiated_by = initiator;
  const pvoValue = n(c.pvo_tracker_amount) ?? n(c.dvo_planned_value) ?? n(c.pvo_cr_amount);
  const voValue = n(c.vo_tracker_amount) ?? pvoValue;
  const dvoValue = n(c.dvo_actual_value) ?? n(c.dvo_tracker_amount) ?? voValue;
  const timeImpact = n(c.dvo_time_impact) ?? n(c.vo_time_impact) ?? n(c.pvo_time_impact) ?? n(c.rfc_time_impact);
  v.time_impact = timeImpact === null ? "" : String(timeImpact);
  // previous determinations on the same contract: the approved DVOs of the other changes on that cost report line
  const previous = c.cost_line_id
    ? (db.prepare("SELECT COALESCE(SUM(COALESCE(dvo_actual_value, dvo_tracker_amount, 0)), 0) AS t FROM changes WHERE programme_id = ? AND cost_line_id = ? AND id <> ? AND (dvo_closed = 1 OR dvo_status_id IN (SELECT id FROM approval_statuses WHERE name = 'Approved'))").get(programmeId, Number(c.cost_line_id), id) as { t: number }).t
    : 0;
  const contractPrice = n(sur.contract?.original_contract);
  let ref = "";
  switch (type) {
    case "rfc":
      ref = s(c.rfc_ref) || s(c.item_no);
      v.rom_estimate = money(n(c.rfc_tracker_amount) ?? pvoValue);
      v.date = s(c.rfc_date) || v.date;
      Object.assign(v, budgetPosition(programmeId, n(c.cost_line_id), n(c.asset_id), n(c.rfc_tracker_amount) ?? pvoValue));
      break;
    case "pvo": {
      ref = s(c.pvo_ref) || s(c.item_no);
      v.add = money(pvoValue);
      v.total_value = money(pvoValue);
      v.cost_items = pvoValue === null ? "" : `1 – ${title} – 0 – ${money(pvoValue)}`;
      v.date = s(c.pvo_date) || v.date;
      Object.assign(v, budgetPosition(programmeId, n(c.cost_line_id), n(c.asset_id), pvoValue));
      const log = changeLogRows(programmeId, n(c.cost_line_id), n(c.contractor_id), id);
      const approvedDvos = log.reduce((t, r) => t + (r.dvo && r.dvoValue !== null ? r.dvoValue : 0), 0);
      const pendingPvos = log.reduce((t, r) => t + (r.pvo && !r.dvo && !r.thisOne && r.pvoValue !== null ? r.pvoValue : 0), 0);
      v.original_contract = money(contractPrice);
      v.current_revised = contractPrice === null ? "" : money(contractPrice + approvedDvos);
      v.approved_dvos = v.approved_dvos || money(approvedDvos);
      v.approved_pvos = money(pendingPvos);
      v.potential_revised = contractPrice === null ? "" : money(contractPrice + approvedDvos + pendingPvos + (pvoValue ?? 0));
      v.original_completion = s(sur.contract?.original_completion_date);
      v.approved_eot = sur.contract?.eot_granted_days === null || sur.contract?.eot_granted_days === undefined ? "" : String(sur.contract.eot_granted_days);
      v.current_completion = s(sur.contract?.revised_completion_date) || s(sur.contract?.original_completion_date);
      v.change_log = changeLogText(log);
      v.eac_included = "Yes";
      break;
    }
    case "vo": {
      ref = s(c.vo_ref) || s(c.item_no);
      const no = (s(c.vo_ref).match(/\d+/)?.[0] ?? "").padStart(3, "0");
      if (no !== "000") v.pvo_no = no;
      v.add = money(voValue);
      v.total_value = money(voValue);
      v.cost_items = voValue === null ? "" : `(a) – ${title} – 0 – ${money(voValue)}`;
      v.rfc_ref = no !== "000" ? `Emergency VO No. ${no}` : "";
      v.instruction_ref = no !== "000" ? `VO-${no}` : "";
      v.clauses = "Contract Clause 12 [Variations and Adjustments]";
      v.date = s(c.vo_date) || s(c.ei_date) || v.date;
      Object.assign(v, budgetPosition(programmeId, n(c.cost_line_id), n(c.asset_id), voValue));
      const log = changeLogRows(programmeId, n(c.cost_line_id), n(c.contractor_id), id);
      const approvedDvos = log.reduce((t, r) => t + (r.dvo && r.dvoValue !== null ? r.dvoValue : 0), 0);
      const pendingPvos = log.reduce((t, r) => t + (r.pvo && !r.dvo && !r.thisOne && r.pvoValue !== null ? r.pvoValue : 0), 0);
      v.original_contract = money(contractPrice);
      v.current_revised = contractPrice === null ? "" : money(contractPrice + approvedDvos);
      v.approved_dvos = v.approved_dvos || money(approvedDvos);
      v.approved_pvos = money(pendingPvos);
      v.potential_revised = contractPrice === null ? "" : money(contractPrice + approvedDvos + pendingPvos + (voValue ?? 0));
      v.original_completion = s(sur.contract?.original_completion_date);
      v.approved_eot = sur.contract?.eot_granted_days === null || sur.contract?.eot_granted_days === undefined ? "" : String(sur.contract.eot_granted_days);
      v.current_completion = s(sur.contract?.revised_completion_date) || s(sur.contract?.original_completion_date);
      break;
    }
    case "dvo":
      ref = s(c.dvo_avi_ref) || s(c.dvo_ref) || s(c.item_no);
      v.add = money(dvoValue);
      v.dvo_value = money(dvoValue);
      v.instruction_ref = s(c.vo_aconex_ref) || s(c.ei_ref) || s(c.vo_ref);
      v.contract_price = money(contractPrice);
      v.previous_dvos = money(previous);
      v.revised_contract = contractPrice === null ? "" : money(contractPrice + previous + (dvoValue ?? 0));
      v.vo_pct = contractPrice ? `${(((previous + (dvoValue ?? 0)) / contractPrice) * 100).toFixed(2)}%` : "";
      v.original_completion = s(sur.contract?.original_completion_date);
      v.previous_eot = sur.contract?.eot_granted_days === null || sur.contract?.eot_granted_days === undefined ? "" : String(sur.contract.eot_granted_days);
      v.this_eot = timeImpact === null ? "" : String(timeImpact);
      v.total_eot = String((n(sur.contract?.eot_granted_days) ?? 0) + (timeImpact ?? 0));
      v.date = s(c.dvo_date) || s(c.dvo_agreement_date) || v.date;
      v.pvo_value = money(pvoValue);
      v.pvo_date = s(c.pvo_date) ? formatDate(s(c.pvo_date)) : "";
      v.pvo_aconex = s(c.pvo_aconex_ref);
      v.pvo_status = status(c.pvo_status_id);
      v.pvo_time_impact = n(c.pvo_time_impact) === null ? "" : String(n(c.pvo_time_impact));
      v.vo_value = money(voValue);
      v.vo_date = s(c.vo_date) || s(c.ei_date) ? formatDate(s(c.vo_date) || s(c.ei_date)) : "";
      v.vo_aconex = s(c.vo_aconex_ref) || s(c.ei_aconex_ref);
      v.dvo_aconex = s(c.dvo_aconex_ref);
      v.dvo_status = status(c.dvo_status_id) || (c.dvo_closed ? "Closed" : "");
      v.contract_ref = v.contract_no;
      v.commencement_date = "";
      v.revised_completion = s(sur.contract?.revised_completion_date) || s(sur.contract?.original_completion_date);
      v.description = `This ${v.dvo_no || "DVO"} confirms the change associated with the following instruction issued:\n1. Variation Order ${s(c.vo_ref) || "No. -"}${s(c.vo_aconex_ref) ? ` Ref: ${s(c.vo_aconex_ref)}` : ""}${s(c.vo_date) ? ` dated ${formatDate(s(c.vo_date))}` : ""} for ${title}.`;
      v.cost_items = dvoValue === null ? "" : `${s(c.vo_ref) || "VO"} – ${title} – 0 – ${money(dvoValue)}`;
      if (pvoValue !== null && dvoValue !== null) {
        const diff = Math.round((pvoValue - dvoValue) * 100) / 100;
        v.movement_note = diff === 0 ? "The DVO value equals the approved PVO value." : `The DVO value is ${diff > 0 ? "lower" : "higher"} than the approved PVO value, with a variance of SAR ${money(Math.abs(diff))}.`;
      }
      Object.assign(v, budgetPosition(programmeId, n(c.cost_line_id), n(c.asset_id), dvoValue));
      v.change_log = changeLogText(changeLogRows(programmeId, n(c.cost_line_id), n(c.contractor_id), id));
      break;
    case "rfa":
      ref = s(c.item_no);
      v.rfa_no = s(c.item_no);
      v.subject = title;
      v.purpose = title;
      v.amount = money(pvoValue ?? dvoValue);
      v.submittal_date = v.date;
      v.contact = user.name;
      v.funding_source = "";
      Object.assign(v, budgetPosition(programmeId, n(c.cost_line_id), n(c.asset_id), pvoValue));
      v.budget_remaining = v.budget_available ? `SAR ${money(v.budget_available)} on ${v.budget_line}` : "";
      break;
    default:
      ref = s(c.item_no);
  }
  const st = status(c.overall_status_id);
  if (st) v.eac_included = v.eac_included ?? "";
  return { values: v, ref, title };
}

function claimValues(type: PackTypeKey, programmeId: number, id: number, user: UserInfo): { values: PackValues; ref: string; title: string } | null {
  const db = getDb();
  const c = db.prepare("SELECT * FROM claims WHERE id = ? AND programme_id = ?").get(id, programmeId) as Row | undefined;
  if (!c) return null;
  const sur = surround(programmeId, c);
  const v = common(programmeId, sur, user);
  if (s(c.contract_no)) v.contract_no = s(c.contract_no);
  const title = s(c.description);
  v.claim_no = s(c.claim_no);
  v.title = title;
  v.claim_summary = s(c.scope);
  v.notice_ref = s(c.notice_letter_ref);
  v.notice_date = s(c.notice_received_date);
  v.submission_ref = s(c.detail_letter_ref);
  v.submission_date = s(c.detail_received_date);
  v.completion_date = s(c.project_completion_date) || s(sur.contract?.original_completion_date);
  v.revised_completion_date = s(c.revised_completion_date) || s(sur.contract?.revised_completion_date);
  const eotNo = title.match(/\bEOT[\s-]*0?(\d+)/i)?.[1];
  v.eot_no = eotNo ? `EOT-${eotNo.padStart(2, "0")}` : "";
  const types = s(c.claim_types) || [c.type_eot ? "EOT" : "", c.type_prolongation ? "Prolongation" : "", c.type_disruption ? "Disruption" : "", c.type_acceleration ? "Acceleration" : "", c.type_other ? s(c.type_other_text) || "Other" : ""].filter(Boolean).join(", ");
  v.claim_type = types;
  const claimedDays = n(c.contractor_eot_days);
  const assessedDays = n(c.determination_eot_days) ?? n(c.employer_eot_days) ?? n(c.engineer_eot_days);
  v.days_claimed = claimedDays === null ? "" : String(claimedDays);
  v.days_assessed = assessedDays === null ? "" : String(assessedDays);
  v.amount_claimed = money(c.contractor_cost);
  v.amount_assessed = money(n(c.determination_cost) ?? n(c.employer_cost) ?? n(c.engineer_cost));
  v.revision = "00";
  v.letter_date = v.date;
  v.claim_letter_ref = v.submission_ref;
  v.claim_letter_date = v.submission_date;
  v.contract_ref = v.contract_no;
  v.contract_price = money(sur.contract?.original_contract);
  v.contract_date = "";
  v.attention = "";
  v.clauses = type === "eot_ear" ? "Clause 8.4 [Extension of Time]" : "Clause 20.1 [Contractor's Claims]";
  v.determination_clause = "Clause 3.5 [Determinations]";
  const ref = s(c.claim_no);
  return { values: v, ref, title };
}

function contractValues(programmeId: number, id: number, user: UserInfo): { values: PackValues; ref: string; title: string } | null {
  const db = getDb();
  const c = db.prepare("SELECT * FROM contracts WHERE id = ? AND programme_id = ?").get(id, programmeId) as Row | undefined;
  if (!c) return null;
  const sur = surround(programmeId, { ...c, contract_id: id });
  const v = common(programmeId, sur, user);
  v.item_no = s(c.sr_no);
  v.stage1_price = money(c.original_contract);
  const approvedVos = (db.prepare("SELECT COALESCE(SUM(COALESCE(dvo_actual_value, dvo_tracker_amount, 0)), 0) AS t FROM changes WHERE programme_id = ? AND cost_line_id = ? AND (dvo_closed = 1 OR dvo_status_id IN (SELECT id FROM approval_statuses WHERE name = 'Approved'))").get(programmeId, Number(c.cost_line_id ?? 0)) as { t: number }).t;
  const revised = (n(c.original_contract) ?? 0) + approvedVos + (n(c.final_account_adjustment) ?? 0);
  v.stage2_price = money(revised);
  v.status = s(c.current_status);
  v.contract_date = "";
  return { values: v, ref: s(c.acc_ref) || `#${s(c.sr_no)}`, title: s(c.title) };
}

/** The values a pack of this category starts with, from the register item picked (or the programme alone). */
export function autoValues(type: PackTypeKey, programmeId: number, sourceId: number | null, user: UserInfo): { values: PackValues; ref: string; title: string } {
  const t = packType(type)!;
  if (sourceId) {
    const r = t.source === "changes" ? changeValues(type, programmeId, sourceId, user) : t.source === "claims" ? claimValues(type, programmeId, sourceId, user) : contractValues(programmeId, sourceId, user);
    if (r) return r;
  }
  const sur = surround(programmeId, {});
  return { values: common(programmeId, sur, user), ref: "", title: "" };
}
