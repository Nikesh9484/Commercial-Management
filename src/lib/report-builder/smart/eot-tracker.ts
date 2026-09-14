import { getDb } from "../../db";
import { getRegisterDef } from "../../registers";
import { recordsForView } from "../../view-mode";
import { todayIso } from "../../format";
import { daysBetween } from "../../registers/enrich-utils";
import type { RecordRow } from "../../registers/types";
import { fieldsFrom, type SmartSource } from "./index";

/**
 * EOT / claims action tracker: the commercial view of every claim – who the action sits with, how
 * long it has sat there, what the next step is and when it is due. Modelled on the tracker the
 * commercial team keeps by hand, so it can replace it.
 *
 * "Days since last action" counts from the claim's Date of last action, falling back to when the row
 * was last edited, and is flagged On track (14 days or less), Watch (15–30) or Stuck (over 30).
 */

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v) || 0);
const CLOSED = ["Approved", "Rejected", "Approved incl. in Lump Sum", "Approved (Authority)", "Approved (proceed to ERI)"];

/** ISO date from a stored value, else null. */
function iso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export const eotTracker: SmartSource = {
  id: "eot_tracker",
  title: "EOT & claims action tracker",
  description: "Every claim as an action list: who it is pending with, the owner, the last action and how many days ago, the target date for the next step, and whether it is on track, to watch, or stuck.",
  ageField: "last_action_date",
  ageMode: "since",
  defaultColumns: ["claim_no", "contract_no", "contractor", "assessment_type", "pending_with", "owner", "last_action_date", "days_since", "flag", "target_date", "days_to_target"],
  suggestGroupBy: "pending_with",
  presets: [
    { id: "open", label: "Open claims only", description: "Everything still to be determined." },
    { id: "stuck", label: "Stuck – over 30 days", description: "No action for more than a month." },
    { id: "overdue_target", label: "Past the target date", description: "The next step is late." },
    { id: "ours", label: "Sitting with us", description: "Pending with a team of ours, not the contractor." },
  ],

  fields: (rows) =>
    fieldsFrom(
      [
        { key: "claim_no", label: "Claim No", type: "text", inDefault: true },
        { key: "contract_no", label: "Ref / contract", type: "text", inDefault: true },
        { key: "package", label: "Package (scope)", type: "text", inDefault: true },
        { key: "contractor", label: "Contractor / consultant", type: "text", inDefault: true },
        { key: "assessment_type", label: "Assessment type", type: "text", inDefault: true },
        { key: "description", label: "Claim description", type: "text", inDefault: false },
        { key: "state", label: "Open / closed", type: "select", inDefault: false },
        { key: "status", label: "Status", type: "select", inDefault: false },
        { key: "pending_with", label: "Pending with", type: "select", inDefault: true },
        { key: "owner", label: "Owner", type: "text", inDefault: true },
        { key: "last_action", label: "Last action", type: "text", inDefault: false },
        { key: "last_action_date", label: "Date of last action", type: "date", inDefault: true },
        { key: "days_since", label: "Days since last action", type: "number", numeric: true, inDefault: true },
        { key: "flag", label: "Flag", type: "select", inDefault: true, help: "On track ≤14 days · Watch 15–30 · Stuck over 30." },
        { key: "target_date", label: "Target date", type: "date", inDefault: true },
        { key: "days_to_target", label: "Days to / past target", type: "number", numeric: true, inDefault: true, help: "Negative = past the target date." },
        { key: "eot_claimed_days", label: "EOT claimed (days)", type: "number", numeric: true, inDefault: false },
        { key: "eot_granted_days", label: "EOT granted (days)", type: "number", numeric: true, inDefault: false },
        { key: "sar_claimed", label: "SAR claimed", type: "money", numeric: true, inDefault: false },
        { key: "sar_determined", label: "SAR determined", type: "money", numeric: true, inDefault: false },
        { key: "nod", label: "Notice of dissatisfaction / dispute", type: "select", inDefault: false },
        { key: "notice_complies", label: "Notice within the contract period", type: "text", inDefault: false },
      ],
      rows,
    ),

  build: (programmeId) => {
    const db = getDb();
    const claims = recordsForView(getRegisterDef("claims")!, db);
    const today = todayIso();
    const out: RecordRow[] = [];

    for (const c of claims) {
      if (Number(c.programme_id) !== programmeId) continue;
      const status = txt(c.status);
      const closed = CLOSED.includes(status);
      const lastDate = iso(c.last_action_date) ?? iso(c.updated_at);
      const daysSince = lastDate ? daysBetween(lastDate, today) : null;
      const target = iso(c.target_date);
      const daysToTarget = target ? daysBetween(today, target) : null;
      const flag = closed ? "Closed" : daysSince === null ? "No date" : daysSince <= 14 ? "On track" : daysSince <= 30 ? "Watch" : "Stuck";
      const pending = txt(c.action_with) || (closed ? "Closed" : "Not set");
      out.push({
        id: Number(c.id),
        claim_no: txt(c.claim_no),
        contract_no: txt(c.contract_no),
        package: txt(c.package_id__label) || txt(c.scope),
        contractor: txt(c.contractor_id__label),
        assessment_type: txt(c.assessment_type) || txt(c.claim_types),
        description: txt(c.description),
        state: closed ? "Closed" : "Open",
        status,
        pending_with: pending,
        owner: txt(c.owner),
        last_action: txt(c.last_action),
        last_action_date: lastDate,
        days_since: daysSince,
        flag,
        target_date: target,
        days_to_target: daysToTarget,
        eot_claimed_days: num(c.contractor_eot_days_view),
        eot_granted_days: num(c.determination_eot_days_view),
        sar_claimed: num(c.contractor_cost_view),
        sar_determined: num(c.determination_cost_view),
        nod: c.nod_dispute === true ? "Notice of dispute" : c.nod_issued === true ? "Notice of dissatisfaction" : "–",
        notice_complies: txt(c.notice_complies),
        flag__tone: flag === "Stuck" ? "red" : flag === "Watch" ? "amber" : flag === "On track" ? "green" : null,
        days_to_target__tone: daysToTarget === null ? null : daysToTarget < 0 ? "red" : daysToTarget <= 7 ? "amber" : null,
      });
    }
    // open first, then the ones that have sat longest
    out.sort((a, b) => Number(a.state === "Closed") - Number(b.state === "Closed") || Number(b.days_since ?? -1) - Number(a.days_since ?? -1));
    return out;
  },
};
