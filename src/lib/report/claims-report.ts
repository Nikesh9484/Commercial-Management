import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { claimCostReportAmount, ASSESSMENT_PARTIES, EAR_STEPS, NOTICE_LIMIT_DAYS, DETAIL_LIMIT_DAYS } from "../registers/defs/claims";
import { formatMoney, formatDate } from "../format";

/**
 * Executive Claims Status Report: the claims of the month, with a short professional narrative
 * written from the data (position, movement since the last report, exposure, compliance, next steps).
 */
export interface ClaimLine {
  claim_no: string;
  contractor: string;
  package: string;
  description: string;
  type: string;
  status: string;
  claimedSar: number;
  assessedSar: number | null; // engineer / employer assessment
  determinedSar: number | null;
  eotClaimed: number | null;
  eotGranted: number | null;
  received: string | null;
  daysSinceReceipt: number | null;
  notice: string;
  stage: string;
  actionWith: string;
  inCostReport: boolean;
  /** Every tracker column, grouped for the claim-by-claim detail pages. */
  detail: ClaimDetail;
}

export interface KV {
  label: string;
  value: string;
}

export interface ClaimDetail {
  contractNo: string;
  assessmentType: string;
  trackerItem: string;
  scope: string;
  notice: KV[];
  particulars: KV[];
  parties: { party: string; eot: string; compensable: string; sar: string; ref: string; date: string }[];
  ear: KV[];
  actions: KV[];
  kpi: KV[];
  project: KV[];
  lastAction: string;
  remark: string;
}

export interface AgeBucket {
  bucket: string;
  n: number;
  sar: number;
  refs: string[];
}

export interface ActionLine {
  actionWith: string;
  n: number;
  sar: number;
  refs: string[];
}

export interface EarLine {
  claim_no: string;
  contractor: string;
  assessmentType: string;
  start: string;
  steps: { label: string; days: string; done: string; state: string }[];
  status: string;
}

export interface EscalationLine {
  claim_no: string;
  contractor: string;
  description: string;
  rejection: string;
  nod: string;
  dispute: string;
  assessmentReport: string;
  eiDvo: string;
  closure: string;
}

export interface ContractorLine {
  contractor: string;
  claims: number;
  pending: number;
  claimedSar: number;
  determinedSar: number;
  eotClaimed: number;
  eotGranted: number;
}

export interface ClaimsReport {
  title: string;
  asOf: string;
  headline: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    contractors: number;
    claimedSar: number;
    determinedSar: number;
    pendingSar: number;
    eotClaimed: number;
    eotGranted: number;
    costReportM: number;
    noticeLate: number;
    detailLate: number;
    disputes: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  claims: ClaimLine[];
  byContractor: ContractorLine[];
  /** Open claims by days since the (detailed) claim was received – the Claims Tracker's response-time bands. */
  ageing: AgeBucket[];
  /** Open claims by the party the next action rests with. */
  byAction: ActionLine[];
  /** Claims with an EAR / HLEAR timetable on the tracker. */
  ear: EarLine[];
  /** Rejections, notices of dissatisfaction and disputes. */
  escalations: EscalationLine[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const has = (v: unknown) => v !== null && v !== undefined && v !== "";
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const money = (n: number) => `SAR ${formatMoney(n)}`;
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const list = (items: string[], max = 4) => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function stageOf(r: RecordRow): { stage: string; actionWith: string } {
  const status = String(r.status ?? "");
  const note = String(r.notes ?? "");
  const m = /Action with:\s*([^·|\n]+)/i.exec(note);
  let actionWith = String(r.action_with ?? "").trim().slice(0, 40) || (m ? m[1].trim().slice(0, 40) : "");
  if (/^(closed|n\/?a|none|-)$/i.test(actionWith)) actionWith = "";
  if (status === "Rejected") return { stage: "Rejected / not to proceed", actionWith: actionWith || "Closed" };
  if (status.startsWith("Approved")) return { stage: has(r.determination_ref) || has(r.determination_cost) || has(r.determination_eot_days) ? "Determined / agreed" : "Approved", actionWith: actionWith || "Closed" };
  if (!has(r.detail_received_date) && !has(r.detail_letter_ref)) return { stage: "Notice received – awaiting detailed claim", actionWith: actionWith || "Contractor" };
  if (has(r.determination_ref) || has(r.determination_date)) return { stage: "Determination issued – closure pending", actionWith: actionWith || "Commercial Team" };
  if (has(r.employer_ref) || has(r.employer_date) || has(r.employer_cost) || has(r.employer_eot_days)) return { stage: "Employer's assessment issued – awaiting determination", actionWith: actionWith || "Employer's Representative" };
  if (has(r.engineer_ref) || has(r.engineer_date) || has(r.engineer_cost) || has(r.engineer_eot_days)) return { stage: "Engineer's recommendation issued – Employer's assessment due", actionWith: actionWith || "Employer's Representative" };
  if (has(r.resubmission_date)) return { stage: "Resubmitted – under assessment", actionWith: actionWith || "Engineer's Representative" };
  return { stage: "Detailed claim received – under assessment", actionWith: actionWith || "Engineer's Representative" };
}

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const dt = (v: unknown) => (has(v) ? formatDate(String(v)) : "");
const n0 = (v: unknown) => (has(v) ? String(Number(v)) : "");
const sarTxt = (v: unknown) => (has(v) ? formatMoney(Number(v)) : "");
const yn = (v: unknown) => (v === true || v === 1 ? "Yes" : v === false || v === 0 ? "No" : "");
const kv = (pairs: [string, string][]): KV[] => pairs.filter(([, v]) => v !== "").map(([label, value]) => ({ label, value }));

/** Adds calendar days to an ISO date. */
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** EAR / HLEAR timetable of a claim: each step's allowance, completion and state at the cut-off. */
function earSteps(r: RecordRow, asOf: string): EarLine["steps"] {
  const start = r.ear_start_date as string | null;
  let from = start;
  return EAR_STEPS.map((st) => {
    const days = r[`${st.prefix}_days`];
    const done = r[`${st.prefix}_date`] as string | null;
    const due = from && has(days) ? addDays(from, Number(days)) : null;
    let state = "";
    if (done) state = due && done > due ? `done ${daysBetween(due, done)}d late` : "done";
    else if (due) state = due < asOf ? `overdue ${daysBetween(due, asOf)}d` : `due ${formatDate(due)}`;
    else if (has(days)) state = "not started";
    from = done ?? due;
    return { label: st.label, days: n0(days), done: dt(done), state };
  });
}

function claimDetail(r: RecordRow, asOf: string): ClaimDetail {
  const parties = ASSESSMENT_PARTIES.map((p) => ({
    party: p.label,
    eot: n0(r[`${p.prefix}_eot_days`]),
    compensable: n0(r[`${p.prefix}_compensable_days`]),
    sar: sarTxt(r[`${p.prefix}_cost`]),
    ref: txt(r[`${p.prefix}_ref`]),
    date: dt(r[`${p.prefix}_date`]),
  }));
  const steps = earSteps(r, asOf);
  return {
    contractNo: txt(r.contract_no),
    assessmentType: txt(r.assessment_type),
    trackerItem: n0(r.tracker_item),
    scope: txt(r.scope),
    notice: kv([
      ["(A) Contractor became aware", dt(r.notice_aware_date)],
      ["Notice letter", txt(r.notice_letter_ref)],
      ["(B) Received by RSG", dt(r.notice_received_date)],
      ["Business days A → B", has(r.notice_business_days) ? `${r.notice_business_days} (limit ${NOTICE_LIMIT_DAYS}) – ${r.notice_complies === "No" ? "late" : "within time"}` : ""],
      ["Per tracker (20 business days)", [n0(r.notice_days_tracker), txt(r.notice_complies_tracker)].filter(Boolean).join(" – ")],
      ["Engineer / Employer response", [txt(r.notice_response_ref), dt(r.notice_response_date)].filter(Boolean).join(", ")],
    ]),
    particulars: kv([
      ["Detailed claim letter", txt(r.detail_letter_ref)],
      ["(C) Received by RSG", dt(r.detail_received_date)],
      ["Business days A → C", has(r.detail_business_days) ? `${r.detail_business_days} (limit ${DETAIL_LIMIT_DAYS}) – ${r.detail_complies === "No" ? "late" : "within time"}` : ""],
      ["Per tracker (30 business days)", [n0(r.detail_days_tracker), txt(r.detail_complies_tracker)].filter(Boolean).join(" – ")],
      ["Engineer / Employer detailed response", [txt(r.detail_response_ref), dt(r.detail_response_date)].filter(Boolean).join(", ")],
      ["High-level EAR RFA", [txt(r.hlear_rfa_ref), dt(r.hlear_rfa_date) ? `approved ${dt(r.hlear_rfa_date)}` : ""].filter(Boolean).join(", ")],
      ["Resubmission / further particulars", [txt(r.resubmission_ref), dt(r.resubmission_date)].filter(Boolean).join(", ")],
    ]),
    parties,
    ear: kv([
      ["EAR / HLEAR start (trigger)", dt(r.ear_start_date)],
      ...steps.map<[string, string]>((st) => [st.label, [st.days ? `${st.days} days` : "", st.done ? `completed ${st.done}` : "", st.state && !st.done ? st.state : st.state.includes("late") ? st.state : ""].filter(Boolean).join(" – ")]),
    ]),
    actions: kv([
      ["Assessment report", txt(r.assessment_report)],
      ["EI (time) / DVO (cost)", txt(r.ei_dvo)],
      ["Action with", txt(r.action_with)],
      ["Discretionary EOT", txt(r.discretionary_eot)],
      ["Rejected on merit / revise & resubmit", txt(r.rejection)],
      ["Notice of Dissatisfaction", yn(r.nod_issued)],
      ["Notice of Dispute", yn(r.nod_dispute)],
      ["Carried in cost report (M)", claimCostReportAmount(r) > 0 ? `Yes – SAR ${formatMoney(claimCostReportAmount(r))}` : "No"],
    ]),
    kpi: kv([
      ["Assessment report closure month", txt(r.closure_month_report)],
      ["Discretionary EOT closure month", txt(r.closure_month_eot)],
      ["DVO closure month", txt(r.closure_month_dvo)],
    ]),
    project: kv([
      ["Project start", dt(r.project_start_date)],
      ["Project completion", dt(r.project_completion_date)],
      ["Revised completion", dt(r.revised_completion_date)],
      ["Late entry in tracker", dt(r.late_entry_date)],
    ]),
    lastAction: txt(r.last_action),
    remark: txt(r.remark),
  };
}

export function buildClaimsReport(data: ReportData): ClaimsReport {
  const rows = data.registers.claims?.rows ?? [];
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const claims: ClaimLine[] = rows.map((r) => {
    const st = stageOf(r);
    const received = (r.detail_received_date as string | null) || (r.notice_received_date as string | null) || null;
    const assessed = numOrNull(r.employer_cost) ?? numOrNull(r.engineer_cost);
    return {
      claim_no: String(r.claim_no ?? ""),
      contractor: String(r.contractor_id__label ?? ""),
      package: String(r.package_id__label ?? r.cost_line_id__label ?? ""),
      description: String(r.description ?? ""),
      type: String(r.claim_types ?? "") || (r.type_other_text ? String(r.type_other_text) : ""),
      status: String(r.status ?? ""),
      claimedSar: num(r.contractor_cost),
      assessedSar: assessed,
      determinedSar: numOrNull(r.determination_cost),
      eotClaimed: numOrNull(r.contractor_eot_days),
      eotGranted: numOrNull(r.determination_eot_days),
      received,
      daysSinceReceipt: received && r.status === "Pending" ? daysBetween(received, asOf) : null,
      notice: String(r.notice_complies ?? "") === "No" ? "Late" : String(r.notice_complies ?? "") === "Yes" ? "OK" : "",
      stage: st.stage,
      actionWith: st.actionWith,
      inCostReport: claimCostReportAmount(r) > 0,
      detail: claimDetail(r, asOf),
    };
  });
  const order: Record<string, number> = { Pending: 0 };
  claims.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1) || b.claimedSar - a.claimedSar);

  const pending = claims.filter((c) => c.status === "Pending");
  const approved = claims.filter((c) => c.status.startsWith("Approved"));
  const rejected = claims.filter((c) => c.status === "Rejected");
  const contractorsSet = new Set(claims.map((c) => c.contractor).filter(Boolean));
  const claimedSar = claims.reduce((t, c) => t + c.claimedSar, 0);
  const determinedSar = claims.reduce((t, c) => t + (c.determinedSar ?? 0), 0);
  const pendingSar = pending.reduce((t, c) => t + c.claimedSar, 0);
  const eotClaimed = claims.reduce((t, c) => t + (c.eotClaimed ?? 0), 0);
  const eotGranted = claims.reduce((t, c) => t + (c.eotGranted ?? 0), 0);
  const costReportM = rows.reduce((t, r) => t + claimCostReportAmount(r), 0);
  const noticeLate = rows.filter((r) => r.notice_complies === "No").length;
  const detailLate = rows.filter((r) => r.detail_complies === "No").length;
  const disputes = rows.filter((r) => r.nod_issued === true || r.nod_issued === 1 || r.nod_dispute === true || r.nod_dispute === 1 || /Notice of (Dissatisfaction|Dispute): Yes/i.test(String(r.notes ?? "")) || r.type_other_text === "Notice of Dissatisfaction").length;

  // ageing of open claims (the tracker's response-time bands, days since receipt)
  const bands: [string, number, number][] = [["1 to 7 days", 1, 7], ["8 to 14 days", 8, 14], ["15 to 21 days", 15, 21], ["Exceeding 21 days", 22, Infinity]];
  const ageing: AgeBucket[] = bands.map(([bucket, lo, hi]) => {
    const inBand = pending.filter((c) => c.daysSinceReceipt !== null && c.daysSinceReceipt >= lo && c.daysSinceReceipt <= hi);
    return { bucket, n: inBand.length, sar: inBand.reduce((t, c) => t + c.claimedSar, 0), refs: inBand.map((c) => c.claim_no) };
  });
  const noDate = pending.filter((c) => c.daysSinceReceipt === null);
  if (noDate.length) ageing.push({ bucket: "No receipt date", n: noDate.length, sar: noDate.reduce((t, c) => t + c.claimedSar, 0), refs: noDate.map((c) => c.claim_no) });

  // who holds the next action on the open claims
  const byA = new Map<string, ActionLine>();
  for (const c of pending) {
    const k = c.actionWith || "(not stated)";
    const row = byA.get(k) ?? { actionWith: k, n: 0, sar: 0, refs: [] };
    row.n++;
    row.sar += c.claimedSar;
    row.refs.push(c.claim_no);
    byA.set(k, row);
  }
  const byAction = [...byA.values()].sort((a, b) => b.n - a.n || b.sar - a.sar);

  // EAR / HLEAR timetable
  const ear: EarLine[] = rows
    .filter((r) => has(r.ear_start_date) || EAR_STEPS.some((st) => has(r[`${st.prefix}_days`]) || has(r[`${st.prefix}_date`])))
    .map((r) => {
      const steps = earSteps(r, asOf);
      const open = steps.find((st) => st.state && !st.done);
      return {
        claim_no: String(r.claim_no ?? ""),
        contractor: String(r.contractor_id__label ?? ""),
        assessmentType: txt(r.assessment_type),
        start: dt(r.ear_start_date),
        steps,
        status: steps.every((st) => st.done || !st.days) ? (steps.some((st) => st.done) ? "Complete" : "") : open ? `${open.label.split(" – ")[0]}: ${open.state}` : "In progress",
      };
    });

  // rejections, notices of dissatisfaction and disputes
  const escalations: EscalationLine[] = rows
    .filter((r) => has(r.rejection) || r.nod_issued === true || r.nod_issued === 1 || r.nod_dispute === true || r.nod_dispute === 1 || r.status === "Rejected")
    .map((r) => ({
      claim_no: String(r.claim_no ?? ""),
      contractor: String(r.contractor_id__label ?? ""),
      description: String(r.description ?? ""),
      rejection: txt(r.rejection) || (r.status === "Rejected" ? "Rejected" : ""),
      nod: yn(r.nod_issued) || "No",
      dispute: yn(r.nod_dispute) || "No",
      assessmentReport: txt(r.assessment_report),
      eiDvo: txt(r.ei_dvo),
      closure: [txt(r.closure_month_report) && `report ${txt(r.closure_month_report)}`, txt(r.closure_month_eot) && `EOT ${txt(r.closure_month_eot)}`, txt(r.closure_month_dvo) && `DVO ${txt(r.closure_month_dvo)}`].filter(Boolean).join(", "),
    }));

  // by contractor
  const byC = new Map<string, ContractorLine>();
  for (const c of claims) {
    const k = c.contractor || "(no contractor)";
    const row = byC.get(k) ?? { contractor: k, claims: 0, pending: 0, claimedSar: 0, determinedSar: 0, eotClaimed: 0, eotGranted: 0 };
    row.claims++;
    if (c.status === "Pending") row.pending++;
    row.claimedSar += c.claimedSar;
    row.determinedSar += c.determinedSar ?? 0;
    row.eotClaimed += c.eotClaimed ?? 0;
    row.eotGranted += c.eotGranted ?? 0;
    byC.set(k, row);
  }
  const byContractor = [...byC.values()].sort((a, b) => b.claimedSar - a.claimedSar);

  // movement since the previous report
  const mv = data.movement;
  const grp = mv?.groups.find((g) => g.key === "claims");
  const movement = mv?.previous && grp
    ? {
        label: `Since ${mv.previous.label}`,
        items: [
          ...grp.added.map((i) => `New: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`),
          ...grp.changed.map((i) => (i.from === i.to ? `${i.key} ${i.title}: claimed amount ${i.delta && i.delta > 0 ? "+" : ""}${formatMoney(i.delta ?? 0)} (still ${i.to})` : `${i.key} ${i.title}: ${i.from} -> ${i.to}${i.delta ? ` (${i.delta > 0 ? "+" : ""}${formatMoney(i.delta)})` : ""}`)),
          ...grp.removed.map((i) => `Removed: ${i.key} ${i.title}`),
        ],
      }
    : null;

  // attention list
  const attention: string[] = [];
  const biggest = pending.slice(0, 3);
  for (const c of biggest) if (c.claimedSar > 0) attention.push(`${c.claim_no} – ${c.contractor}: ${money(c.claimedSar)} claimed${c.eotClaimed ? `, ${c.eotClaimed} days` : ""}. ${c.stage}. Action with ${c.actionWith}.`);
  const stale = pending.filter((c) => (c.daysSinceReceipt ?? 0) > 90);
  if (stale.length) attention.push(`${plural(stale.length, "pending claim")} received more than 90 days ago (${list(stale.map((c) => c.claim_no))}) – assessment overdue against the contract timetable.`);
  if (noticeLate) attention.push(`${plural(noticeLate, "claim")} notified later than the contractual notice period – a time-bar defence is available and should be preserved in the response.`);
  if (disputes) attention.push(`${plural(disputes, "claim")} carry a Notice of Dissatisfaction or Dispute – escalation risk; legal / senior review recommended.`);
  const earLate = ear.filter((e) => e.steps.some((st) => st.state.startsWith("overdue")));
  if (earLate.length) attention.push(`${plural(earLate.length, "assessment report")} (EAR / HLEAR) ${earLate.length === 1 ? "is" : "are"} past the tracker's timetable (${list(earLate.map((e) => e.claim_no))}) – the draft, TIA or final report is overdue.`);
  const unlinked = rows.filter((r) => !r.cost_line_id).length;
  if (unlinked) attention.push(`${plural(unlinked, "claim")} not yet linked to a cost report line – link them so the cost report reflects any determination.`);

  // narrative
  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      claims.length === 0
        ? `No contractor claims are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(claims.length, "claim")} ${claims.length === 1 ? "is" : "are"} recorded against ${assetName} from ${plural(contractorsSet.size, "contractor")}: ${pending.length} pending, ${approved.length} determined or approved and ${rejected.length} rejected. Contractors have claimed ${money(claimedSar)}${eotClaimed ? ` and ${eotClaimed} days of extension of time` : ""}; determinations to date total ${money(determinedSar)}${eotGranted ? ` and ${eotGranted} days` : ""}, i.e. ${pct(determinedSar, claimedSar)}% of the value${eotClaimed ? ` and ${pct(eotGranted, eotClaimed)}% of the time` : ""} claimed. ${
            pendingSar
              ? `The open claims carry a gross exposure of ${money(pendingSar)}, of which ${money(costReportM)} is carried in the cost report (column M); the balance is reported through the early warnings until determined.`
              : `The cost report carries ${money(costReportM)} for claims.`
          }`,
  });
  if (mv?.previous) {
    const n = grp ? grp.added.length + grp.changed.length + grp.removed.length : 0;
    const mcol = mv.keyMovements.find((k) => k.col === "M");
    narrative.push({
      heading: `Movement since ${mv.previous.label}`,
      text:
        n === 0
          ? `There has been no movement in the claims register since ${mv.previous.label}.`
          : `${grp!.added.length ? `${plural(grp!.added.length, "new claim")} ${grp!.added.length === 1 ? "was" : "were"} received (${list(grp!.added.map((i) => i.key))}). ` : ""}${grp!.changed.length ? `${plural(grp!.changed.length, "claim")} changed status or value (${list(grp!.changed.map((i) => i.key))}). ` : ""}${grp!.removed.length ? `${plural(grp!.removed.length, "claim")} ${grp!.removed.length === 1 ? "was" : "were"} removed from the register. ` : ""}The claims column of the cost report moved by ${mcol && Math.abs(mcol.kpiDelta) >= 0.005 ? `${mcol.kpiDelta > 0 ? "+" : ""}${formatMoney(mcol.kpiDelta)}` : "nil"}.`,
    });
  }
  if (pending.length) {
    const top = pending[0];
    const byStage = new Map<string, number>();
    for (const c of pending) byStage.set(c.stage, (byStage.get(c.stage) ?? 0) + 1);
    narrative.push({
      heading: "Exposure and status of open claims",
      text: `The largest open item is ${top.claim_no} (${top.contractor}${top.type ? `, ${top.type}` : ""}) at ${money(top.claimedSar)}${top.eotClaimed ? ` and ${top.eotClaimed} days` : ""}, currently at the stage "${top.stage}" with action resting with ${top.actionWith}. Across the ${plural(pending.length, "open claim")}: ${[...byStage.entries()].map(([s, k]) => `${k} ${s.toLowerCase()}`).join("; ")}.${
        pending.some((c) => c.assessedSar !== null) ? ` Where an assessment exists, the assessed value totals ${money(pending.reduce((t, c) => t + (c.assessedSar ?? 0), 0))} against ${money(pending.filter((c) => c.assessedSar !== null).reduce((t, c) => t + c.claimedSar, 0))} claimed for the same items.` : ""
      }`,
    });
  }
  narrative.push({
    heading: "Compliance and risk",
    text: `${noticeLate === 0 && detailLate === 0 ? "All claims were notified and particularised within the contractual time limits." : `${noticeLate ? `${plural(noticeLate, "claim")} ${noticeLate === 1 ? "was" : "were"} notified late (later than 28 business days)` : ""}${noticeLate && detailLate ? " and " : ""}${detailLate ? `${plural(detailLate, "detailed claim")} arrived later than 42 business days` : ""}; the time-bar position is recorded in the register and should be maintained in correspondence.`} ${disputes ? `${plural(disputes, "claim")} ${disputes === 1 ? "has" : "have"} escalated to a Notice of Dissatisfaction or Dispute and ${disputes === 1 ? "is" : "are"} being managed with legal support.` : "No claim has escalated to a formal dispute."}`,
  });
  narrative.push({
    heading: "Outlook and recommended actions",
    text:
      pending.length === 0
        ? "No claims are open. The commercial team will continue to monitor early warnings for events that may give rise to a claim."
        : `The commercial team's priorities for the coming period are to ${[
            pending.some((c) => c.stage.startsWith("Detailed claim received") || c.stage.startsWith("Resubmitted")) ? "complete the assessment of the claims under review and issue the Engineer's recommendations" : "",
            pending.some((c) => c.stage.startsWith("Engineer's")) ? "obtain the Employer's assessment on the claims already recommended" : "",
            pending.some((c) => c.stage.startsWith("Employer's") || c.stage.startsWith("Determination issued")) ? "close out the determinations issued and agree final values with the contractors" : "",
            pending.some((c) => c.stage.startsWith("Notice received")) ? "press the contractors for the outstanding detailed particulars" : "",
          ]
            .filter(Boolean)
            .join(", ")}. Determined amounts will be carried into the cost report and, where budget is not available, funded through the change management process.`,
  });

  return {
    title: `Claims Status Report – ${data.period.label}`,
    asOf,
    headline: {
      total: claims.length,
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      contractors: contractorsSet.size,
      claimedSar,
      determinedSar,
      pendingSar,
      eotClaimed,
      eotGranted,
      costReportM,
      noticeLate,
      detailLate,
      disputes,
    },
    narrative,
    movement,
    attention,
    claims,
    byContractor,
    ageing,
    byAction,
    ear,
    escalations,
  };
}
