import { getDb } from "../../db";
import { getRegisterDef } from "../../registers";
import { recordsForView } from "../../view-mode";
import { todayIso } from "../../format";
import { daysBetween } from "../../registers/enrich-utils";
import type { RecordRow } from "../../registers/types";
import { fieldsFrom, type SmartSource } from "./index";
import { paymentsDue } from "./payments-due";

/**
 * One list of everything across the whole project that is late, expiring or stuck – bonds about to
 * lapse, payments past their date, claims with no movement, changes going nowhere, actions past
 * their due date, final accounts past their forecast closure. It is the list to work down on a
 * Monday morning, and it is assembled from every register at once.
 *
 * It is built as a decision queue rather than a catalogue: every line says what happens if nothing
 * is done and when the decision is needed, and the list is ranked by consequence (value at stake
 * weighted by how long it has been waiting), not by which module it came from.
 */

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const SEVERITY = ["Critical", "High", "Medium", "Low"];
const rank = (s: string) => { const i = SEVERITY.indexOf(s); return i < 0 ? 9 : i; };
const CHANGE_CLOSED = ["Approved", "Rejected", "Cancelled", "Superseded", "Transferred"];
const CLAIM_CLOSED = ["Approved", "Rejected", "Approved incl. in Lump Sum", "Approved (Authority)", "Approved (proceed to ERI)"];

function iso(v: unknown): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

export const attention: SmartSource = {
  id: "attention",
  title: "What needs attention (whole project)",
  description: "Everything late, expiring or stuck, pulled from every module into one ranked list: bonds about to lapse, payments past their date, claims with no movement, changes going nowhere, overdue actions and final accounts past their forecast closure.",
  ageField: "date",
  ageMode: "due",
  defaultColumns: ["severity", "module", "ref", "item", "party", "who", "date", "days", "value", "consequence", "action"],
  suggestGroupBy: "module",
  presets: [
    { id: "critical", label: "Critical only", description: "The items that cannot wait." },
    { id: "money", label: "Money at stake", description: "Only items carrying a value." },
    { id: "week", label: "Due or overdue this week", description: "Seven days either side of today." },
  ],

  fields: (rows) =>
    fieldsFrom(
      [
        { key: "severity", label: "Severity", type: "select", inDefault: true },
        { key: "module", label: "Module", type: "select", inDefault: true },
        { key: "ref", label: "Reference", type: "text", inDefault: true },
        { key: "item", label: "What it is", type: "text", inDefault: true },
        { key: "party", label: "Contractor / consultant", type: "text", inDefault: true },
        { key: "who", label: "Sitting with", type: "text", inDefault: true },
        { key: "date", label: "Date it turns on", type: "date", inDefault: true, help: "The expiry, due or target date the item is measured against." },
        { key: "days", label: "Days late (−) / left", type: "number", numeric: true, inDefault: true },
        { key: "value", label: "Value at stake", type: "money", numeric: true, inDefault: true },
        { key: "consequence", label: "If nothing is done", type: "text", inDefault: true },
        { key: "action", label: "What to do", type: "text", inDefault: true },
        { key: "priority", label: "Priority score", type: "number", numeric: true, inDefault: false, help: "Value at stake weighted by how long the item has been waiting – what the list is ranked on." },
      ],
      rows,
    ),

  build: (programmeId) => {
    const db = getDb();
    const today = todayIso();
    const out: RecordRow[] = [];
    let seq = 1;
    const mine = (rows: RecordRow[]) => rows.filter((r) => Number(r.programme_id) === programmeId);
    const add = (severity: string, module: string, ref: string, item: string, party: string, who: string, date: string | null, days: number | null, value: number, action: string, consequence: string) => {
      // ranked by consequence: what is at stake, weighted by how long it has been sitting
      const late = days !== null && days < 0 ? -days : 0;
      const weight = severity === "Critical" ? 4 : severity === "High" ? 3 : severity === "Medium" ? 2 : 1;
      out.push({
        id: seq++,
        severity,
        module,
        ref,
        item: item.length > 140 ? `${item.slice(0, 137)}…` : item,
        party,
        who,
        date,
        days,
        value,
        consequence,
        action,
        priority: Math.round((value / 1000) * (1 + late / 30) * weight),
        severity__tone: severity === "Critical" ? "red" : severity === "High" ? "amber" : severity === "Medium" ? null : "green",
        days__tone: days !== null && days < 0 ? "red" : null,
      });
    };

    // Bonds and insurance about to lapse, or already lapsed on a live contract
    for (const b of mine(recordsForView(getRegisterDef("bonds")!, db))) {
      if (b.released === true || b.superseded === true) continue;
      const d = b.days_to_expiry === null || b.days_to_expiry === undefined ? null : Number(b.days_to_expiry);
      if (d === null || d > 30) continue;
      add(
        d < 0 ? "Critical" : d <= 15 ? "High" : "Medium",
        "Bonds & insurance",
        txt(b.ref),
        `${txt(b.type_id__label)} expire${d < 0 ? "d" : "s"} ${d < 0 ? `${-d} days ago` : `in ${d} days`}`,
        txt(b.contractor_id__label),
        "Commercial",
        iso(b.expiry_date),
        d,
        num(b.amount_provided),
        d < 0 ? "Renew, or confirm the contract is closed and release the bond." : "Start the renewal now.",
        d < 0 ? "The works are uncovered: a call on the bond or a claim on the policy would not be met." : "Cover lapses and the contract falls out of compliance.",
      );
    }

    // Payments certified and past their contractual date
    for (const p of paymentsDue.build(programmeId)) {
      const days = p.days === null || p.days === undefined ? null : Number(p.days);
      if (days === null || days >= 0) continue;
      add(
        days < -30 ? "Critical" : "High",
        "Invoices & payments",
        `${txt(p.contract_code)} ${txt(p.application_no)}`,
        `Certified payment ${-days} days past the contractual date`,
        txt(p.contractor),
        "Finance",
        txt(p.due_date) || null,
        days,
        num(p.total_due),
        "Chase the payment; confirm the invoice is in the system.",
        "Interest on late payment and a deteriorating relationship with the contractor.",
      );
    }

    // Claims with no movement, or past the target date for the next step
    for (const c of mine(recordsForView(getRegisterDef("claims")!, db))) {
      if (CLAIM_CLOSED.includes(txt(c.status))) continue;
      const last = iso(c.last_action_date) ?? iso(c.updated_at);
      const since = last ? daysBetween(last, today) : null;
      const target = iso(c.target_date);
      const toTarget = target ? daysBetween(today, target) : null;
      const late = toTarget !== null && toTarget < 0;
      if (!late && (since === null || since <= 30)) continue;
      add(
        late && since !== null && since > 60 ? "Critical" : "High",
        "Claims & disputes",
        txt(c.claim_no),
        late ? `Past the target date for the next step${since !== null ? `, no action for ${since} days` : ""}` : `No action for ${since} days`,
        txt(c.contractor_id__label),
        txt(c.action_with) || txt(c.owner) || "Commercial",
        target ?? last,
        late ? toTarget : since === null ? null : -since,
        num(c.contractor_cost_view),
        late ? "Reset the target date or close the step out." : "Pick the claim back up – it has gone quiet.",
        "Time-bar and quantum arguments weaken as the contemporaneous record ages.",
      );
    }

    // Changes still open a long time after they were raised
    for (const ch of mine(recordsForView(getRegisterDef("changes")!, db))) {
      if (CHANGE_CLOSED.includes(txt(ch.overall_status_id))) continue;
      const raised = iso(ch.date_raised);
      const age = raised ? daysBetween(raised, today) : null;
      if (age === null || age <= 60) continue;
      const value = num(ch.dvo_tracker_amount) || num(ch.pvo_tracker_amount) || num(ch.rfc_tracker_amount);
      add(
        age > 120 ? "High" : "Medium",
        "Change management",
        txt(ch.item_no),
        `Open ${age} days after it was raised`,
        txt(ch.contractor_id__label),
        txt(ch.action_pending_by) || "Commercial",
        raised,
        -age,
        value,
        "Push the change to its next stage or close it out.",
        "The cost stays in the forecast unresolved and the contractor may price the delay.",
      );
    }

    // Meeting actions past their due date
    for (const a of mine(recordsForView(getRegisterDef("actions")!, db))) {
      const status = txt(a.status);
      if (/closed|complete|done/i.test(status)) continue;
      const due = iso(a.due_date);
      if (!due) continue;
      const days = daysBetween(today, due);
      if (days >= 0) continue;
      add(days < -30 ? "High" : "Medium", "Minutes & actions", txt(a.item_no), `${txt(a.topic) || "Action"} – ${-days} days past its due date`, "", txt(a.owner) || "Commercial", due, days, 0, "Close the action out or agree a new date at the next meeting.", "The action carries forward again and the meeting record loses its authority.");
    }

    // Final accounts past their forecast closure
    for (const f of mine(recordsForView(getRegisterDef("final_accounts")!, db))) {
      if (/closed|not required|no fa/i.test(txt(f.status))) continue;
      const forecast = iso(f.forecast_closure_date);
      if (!forecast) continue;
      const days = daysBetween(today, forecast);
      if (days >= 0) continue;
      add(days < -90 ? "High" : "Medium", "Final account status", txt(f.acc_ref), `Final account still open ${-days} days after the forecast closure`, txt(f.contractor_id__label), txt(f.responsible) || "Commercial", forecast, days, num(f.afa), "Agree the final account or move the forecast date.", "Retention stays held, the contract cannot be closed and the outturn stays uncertain.");
    }

    // Contracts certified beyond their revised value
    for (const c of mine(recordsForView(getRegisterDef("contracts")!, db))) {
      const pct = c.pct_certified === null || c.pct_certified === undefined ? null : Number(c.pct_certified);
      if (pct === null || pct <= 100.5) continue;
      add("High", "Invoices & payments", txt(c.acc_ref) || txt(c.reef_po_no), `Certified ${pct.toFixed(1)}% of the revised contract value`, txt(c.contractor_id__label), "Commercial", null, null, num(c.net_cum_certified) - num(c.revised_contract_value), "Check the revised contract value carries every approved change.", "Either the contract value is understated or the contractor has been over-certified.");
    }

    // ranked by consequence, not by which module it came from: an attention list sorted by origin gets skimmed
    out.sort((a, b) => num(b.priority) - num(a.priority) || (rank(String(a.severity)) - rank(String(b.severity))) || Number(a.days ?? 0) - Number(b.days ?? 0));
    return out.map((r, i) => ({ ...r, id: i + 1 }));
  },
};
