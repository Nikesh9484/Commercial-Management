import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatMoney, formatDate } from "../format";
import { num, numOrNull, txt, money, plural, list, groupByParty, capMovement, type PartyGroup } from "./report-utils";

/**
 * Executive Change Management Status Report: where every change sits on the Early Warning -> RFC ->
 * PVO -> VO -> EI -> DVO -> Funding path, how much it is worth, how it feeds the cost report, and
 * which items need attention – with a narrative written from the register, as in the other executive
 * reports.
 */
const STAGES = [
  { prefix: "rfc", label: "RFC", full: "Request for Change" },
  { prefix: "pvo", label: "PVO", full: "Potential Variation Order" },
  { prefix: "vo", label: "VO", full: "Variation Order" },
  { prefix: "dvo", label: "DVO", full: "Determined Variation Order" },
] as const;
const APPROVED = ["Approved", "Review Complete"];
const DEAD = ["Rejected", "Cancelled", "Superseded", "Transferred"];

export interface ChangeLine {
  item_no: string;
  description: string;
  stage: string;
  costReportColumn: "H" | "J" | "K" | "L" | null;
  amount: number;
  status: string;
  daysOpen: number | null;
  dateRaised: string | null;
  contractor: string;
  package: string;
  category: string;
  actionPendingBy: string;
}

export interface StageCount {
  stage: string;
  full: string;
  total: number;
  approved: number;
  pending: number;
  dead: number;
  value: number;
}

export interface ChangeAgeBucket {
  bucket: string;
  n: number;
  value: number;
}

export interface ChangesReport {
  title: string;
  asOf: string;
  headline: {
    total: number;
    open: number;
    closed: number;
    overdue30: number;
    overdue60: number;
    unlinked: number;
    dvoValue: number;
    pvoValue: number;
    rfcValue: number;
    totalLiveValue: number;
    dvoPending: number;
    dvoPendingValue: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  byStage: StageCount[];
  ageing: ChangeAgeBucket[];
  open: ChangeLine[];
  byCategory: { category: string; n: number; value: number }[];
  /** The open items as one table per stage (DVO pending, PVO live …), each contractor by contractor. */
  sections: { title: string; count: number; value: number; groups: PartyGroup<ChangeLine>[] }[];
}

function stageOf(r: RecordRow): { stage: string; col: "H" | "J" | "K" | "L" | null; amount: number } {
  const closed = r.dvo_closed === true || DEAD.includes(txt(r.overall_status_id__label));
  if (closed) return { stage: "Closed", col: null, amount: 0 };
  const current = txt(r.current_stage) || "Not started";
  if (current === "DVO" || current === "Funding") {
    const st = txt(r.dvo_status_id__label);
    if (APPROVED.includes(st)) return { stage: "DVO – Approved", col: "H", amount: num(r.dvo_cr_amount ?? r.dvo_tracker_amount) };
    return { stage: "DVO – Pending", col: null, amount: 0 };
  }
  if (current === "VO" || current === "EI") {
    const st = txt(r.vo_status_id__label);
    if (!DEAD.includes(st)) return { stage: "VO / EI – live", col: "J", amount: num(r.vo_cr_amount) };
  }
  if (current === "PVO") {
    const st = txt(r.pvo_status_id__label);
    if (!DEAD.includes(st)) return { stage: "PVO – live", col: "J", amount: num(r.pvo_cr_amount ?? r.pvo_tracker_amount) };
  }
  if (current === "RFC") {
    const st = txt(r.rfc_status_id__label);
    if (!DEAD.includes(st)) return { stage: "RFC – live", col: "K", amount: num(r.rfc_cr_amount ?? r.rfc_tracker_amount) };
  }
  return { stage: current, col: null, amount: 0 };
}

export function buildChangesReport(data: ReportData): ChangesReport {
  const rows = (data.registers.changes?.rows ?? []) as RecordRow[];
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const closedRows = rows.filter((r) => r.dvo_closed === true || DEAD.includes(txt(r.overall_status_id__label)));
  const openRows = rows.filter((r) => !closedRows.includes(r));
  const overdue30 = openRows.filter((r) => num(r.days_open) > 30 && num(r.days_open) <= 60).length;
  const overdue60 = openRows.filter((r) => num(r.days_open) > 60).length;
  const unlinked = rows.filter((r) => !r.cost_line_id).length;

  const byStageMap = new Map<string, { n: number; approved: number; pending: number; dead: number; value: number }>();
  for (const s of STAGES) byStageMap.set(s.prefix, { n: 0, approved: 0, pending: 0, dead: 0, value: 0 });
  let dvoValue = 0;
  let pvoValue = 0;
  let rfcValue = 0;
  let dvoPending = 0;
  let dvoPendingValue = 0;
  for (const r of rows) {
    for (const s of STAGES) {
      const status = txt(r[`${s.prefix}_status_id__label`]);
      const has = r[`${s.prefix}_ref`] || r[`${s.prefix}_date`] || status || r[`${s.prefix}_cr_amount`] !== null;
      if (!has) continue;
      const bucket = byStageMap.get(s.prefix)!;
      bucket.n++;
      const amt = num(r[`${s.prefix}_cr_amount`] ?? r[`${s.prefix}_tracker_amount`]);
      if (APPROVED.includes(status)) {
        bucket.approved++;
        bucket.value += amt;
      } else if (DEAD.includes(status)) bucket.dead++;
      else {
        bucket.pending++;
        if (s.prefix === "dvo") {
          dvoPending++;
          dvoPendingValue += amt;
        }
      }
    }
    const st = stageOf(r);
    if (st.col === "H") dvoValue += st.amount;
    else if (st.col === "J") pvoValue += st.amount;
    else if (st.col === "K") rfcValue += st.amount;
  }

  const byStage: StageCount[] = STAGES.map((s) => {
    const b = byStageMap.get(s.prefix)!;
    return { stage: s.label, full: s.full, total: b.n, approved: b.approved, pending: b.pending, dead: b.dead, value: Math.round(b.value * 100) / 100 };
  });

  const open: ChangeLine[] = openRows
    .map((r) => {
      const st = stageOf(r);
      return {
        item_no: txt(r.item_no),
        description: txt(r.description),
        stage: st.stage,
        costReportColumn: st.col,
        amount: Math.round(st.amount * 100) / 100,
        status: txt(r.overall_status_id__label),
        daysOpen: numOrNull(r.days_open),
        dateRaised: txt(r.date_raised) || null,
        contractor: txt(r.contractor_id__label),
        package: txt(r.package_id__label),
        category: txt(r.change_category_id__label),
        actionPendingBy: txt(r.action_pending_by),
      };
    })
    .sort((a, b) => (b.daysOpen ?? 0) - (a.daysOpen ?? 0) || Math.abs(b.amount) - Math.abs(a.amount));

  const ageBuckets: [string, number, number][] = [
    ["Under 30 days", 0, 30],
    ["30 to 60 days", 31, 60],
    ["60 to 90 days", 61, 90],
    ["Over 90 days", 91, Infinity],
  ];
  const ageing: ChangeAgeBucket[] = ageBuckets.map(([bucket, lo, hi]) => {
    const inBand = open.filter((o) => o.daysOpen !== null && o.daysOpen >= lo && o.daysOpen <= hi);
    return { bucket, n: inBand.length, value: Math.round(inBand.reduce((t, o) => t + Math.abs(o.amount), 0) * 100) / 100 };
  });

  const byCatMap = new Map<string, { n: number; value: number }>();
  for (const o of open) {
    const k = o.category || "(no category)";
    const r = byCatMap.get(k) ?? { n: 0, value: 0 };
    r.n++;
    r.value += Math.abs(o.amount);
    byCatMap.set(k, r);
  }
  const byCategory = [...byCatMap.entries()].map(([category, v]) => ({ category, n: v.n, value: Math.round(v.value * 100) / 100 })).sort((a, b) => b.value - a.value);

  const totalLiveValue = Math.round((dvoValue + pvoValue + rfcValue) * 100) / 100;

  const headline: ChangesReport["headline"] = {
    total: rows.length,
    open: openRows.length,
    closed: closedRows.length,
    overdue30,
    overdue60,
    unlinked,
    dvoValue: Math.round(dvoValue * 100) / 100,
    pvoValue: Math.round(pvoValue * 100) / 100,
    rfcValue: Math.round(rfcValue * 100) / 100,
    totalLiveValue,
    dvoPending,
    dvoPendingValue: Math.round(dvoPendingValue * 100) / 100,
  };

  // movement since the previous report
  const mv = data.movement;
  const grp = mv?.groups.find((g) => g.key === "changes");
  const movement = capMovement(
    mv?.previous && grp
      ? {
          label: `Since ${mv.previous.label}`,
          items: [
            ...grp.added.map((i) => `New: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`),
            ...grp.changed.map((i) => (i.from === i.to ? `${i.key} ${i.title}: value ${i.delta && i.delta > 0 ? "+" : ""}${formatMoney(i.delta ?? 0)} (still ${i.to})` : `${i.key} ${i.title}: ${i.from} -> ${i.to}${i.delta ? ` (${i.delta > 0 ? "+" : ""}${formatMoney(i.delta)})` : ""}`)),
            ...grp.removed.map((i) => `Removed: ${i.key} ${i.title}`),
          ],
        }
      : null,
  );

  // attention
  const attention: string[] = [];
  const stale90 = open.filter((o) => (o.daysOpen ?? 0) > 90);
  if (stale90.length) attention.push(`${plural(stale90.length, "change")} open more than 90 days (${list(stale90.map((o) => o.item_no))}) – push for a decision at the next stage.`);
  if (unlinked) attention.push(`${plural(unlinked, "change")} not linked to a cost report line – its value cannot flow into columns H, J or K until it is.`);
  const bigPending = open.filter((o) => o.stage === "DVO – Pending" && Math.abs(o.amount) > 0).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 3);
  if (bigPending.length) attention.push(`${plural(bigPending.length, "DVO")} pending approval carry the largest exposure (${list(bigPending.map((o) => `${o.item_no} ${money(Math.abs(o.amount))}`))}) – closing these converts potential cost into a determined variation.`);
  const noAction = open.filter((o) => !o.actionPendingBy);
  if (noAction.length > open.length * 0.3 && open.length > 5) attention.push(`${plural(noAction.length, "open change")} has no "action pending by" recorded – assign an owner so nothing stalls unnoticed.`);

  // narrative
  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      rows.length === 0
        ? `No changes are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(rows.length, "change")} ${rows.length === 1 ? "is" : "are"} recorded against ${assetName}: ${headline.open} open and ${headline.closed} closed. Live changes carry ${money(totalLiveValue)} of cost-report exposure – ${money(headline.dvoValue)} determined (column H), ${money(headline.pvoValue)} potential (column J) and ${money(headline.rfcValue)} at request stage (column K). ${headline.dvoPending ? `A further ${money(headline.dvoPendingValue)} sits in ${plural(headline.dvoPending, "DVO")} awaiting approval.` : "No DVO is currently awaiting approval."}`,
  });
  if (mv?.previous) {
    const n = grp ? grp.added.length + grp.changed.length + grp.removed.length : 0;
    narrative.push({
      heading: `Movement since ${mv.previous.label}`,
      text: n === 0 ? `There has been no movement in the change register since ${mv.previous.label}.` : `${grp!.added.length ? `${plural(grp!.added.length, "new change")} ${grp!.added.length === 1 ? "was" : "were"} raised (${list(grp!.added.map((i) => i.key))}). ` : ""}${grp!.changed.length ? `${plural(grp!.changed.length, "change")} moved stage or value (${list(grp!.changed.map((i) => i.key))}). ` : ""}${grp!.removed.length ? `${plural(grp!.removed.length, "change")} ${grp!.removed.length === 1 ? "was" : "were"} removed. ` : ""}`,
    });
  }
  narrative.push({
    heading: "Ageing of open changes",
    text: open.length === 0 ? "No open changes." : `${headline.overdue60 ? `${plural(headline.overdue60, "change")} ${headline.overdue60 === 1 ? "has" : "have"} been open more than 60 days` : "No change has been open more than 60 days"}${headline.overdue30 ? `, and a further ${plural(headline.overdue30, "change")} ${headline.overdue30 === 1 ? "is" : "are"} between 30 and 60 days` : ""}. The oldest band (${ageing[3].bucket.toLowerCase()}) carries ${money(ageing[3].value)} across ${plural(ageing[3].n, "item")}.`,
  });
  narrative.push({
    heading: "Outlook",
    text: `${byStage.find((s) => s.stage === "DVO")?.pending ? "Priorities are to close the pending DVOs so their value is determined, and " : ""}to keep every change linked to its cost report line so the tracker and the cost report stay in step.${headline.unlinked ? ` ${plural(headline.unlinked, "change")} still needs linking.` : ""}`,
  });

  // One table per stage, because a DVO pending with the Engineer and a PVO awaiting a quotation are
  // different conversations, and within each, one block per contractor – which is how they are chased.
  const stageNames = [...new Set(open.map((o) => o.stage))];
  const sections = stageNames
    .map((title) => {
      const mine = open.filter((o) => o.stage === title);
      return {
        title,
        count: mine.length,
        value: Math.round(mine.reduce((t, o) => t + o.amount, 0) * 100) / 100,
        groups: groupByParty(mine, (o) => o.contractor, (o) => ({ amount: o.amount }), (a, b) => (b.daysOpen ?? 0) - (a.daysOpen ?? 0)),
      };
    })
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

  return {
    title: `Change Management Status Report – ${data.period.label}`,
    asOf,
    headline,
    narrative,
    movement,
    attention,
    byStage,
    ageing,
    open,
    sections,
    byCategory,
  };
}

