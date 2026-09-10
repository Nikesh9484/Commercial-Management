import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { claimCostReportAmount } from "../registers/defs/claims";
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
  let actionWith = m ? m[1].trim().slice(0, 40) : "";
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
  const disputes = rows.filter((r) => /Notice of (Dissatisfaction|Dispute): Yes/i.test(String(r.notes ?? "")) || r.type_other_text === "Notice of Dissatisfaction").length;

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
          ...grp.changed.map((i) => `${i.key} ${i.title}: ${i.from} -> ${i.to}${i.delta ? ` (${i.delta > 0 ? "+" : ""}${formatMoney(i.delta)})` : ""}`),
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
  };
}
