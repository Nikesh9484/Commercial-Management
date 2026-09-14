import { getDb } from "../../db";
import { getRegisterDef } from "../../registers";
import { recordsForView } from "../../view-mode";
import { todayIso } from "../../format";
import { daysBetween } from "../../registers/enrich-utils";
import type { RecordRow } from "../../registers/types";
import { fieldsFrom, type SmartSource } from "./index";

/**
 * One line per contract, pulling together what every module says about it: the value and how much of
 * it has been certified and paid, how well payments are running to the contractual timetable, what
 * is still open against it in changes and claims, and whether its bonds and final account are in
 * order. It answers "how is this contract actually doing" without opening six pages.
 */

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const CHANGE_CLOSED = ["Approved", "Rejected", "Cancelled", "Superseded", "Transferred"];
const CLAIM_CLOSED = ["Approved", "Rejected", "Approved incl. in Lump Sum", "Approved (Authority)", "Approved (proceed to ERI)"];

export const scorecard: SmartSource = {
  id: "scorecard",
  title: "Contract performance scorecard",
  description: "One line per contract drawing on every module: contract value and how much is certified and paid, payment performance against the contractual timetable, what is still open in changes and claims, bond cover and the final account position.",
  suggestGroupBy: "health",
  defaultColumns: ["contract_ref", "contractor", "revised_value", "certified", "pct_certified", "paid", "unpaid_certified", "overdue_count", "avg_days_late", "bond_status", "fa_status", "health"],
  presets: [
    { id: "attention", label: "Contracts needing attention", description: "Late payments, expired bonds or over-certification." },
    { id: "closing", label: "Approaching final account", description: "Over 90% certified." },
    { id: "big", label: "Largest contracts", description: "Revised value over SAR 10m." },
  ],

  fields: (rows) =>
    fieldsFrom(
      [
        { key: "contract_ref", label: "Contract", type: "text", inDefault: true },
        { key: "contractor", label: "Contractor / consultant", type: "text", inDefault: true },
        { key: "package", label: "Package", type: "text", inDefault: false },
        { key: "status", label: "Contract status", type: "select", inDefault: true },
        { key: "original_value", label: "Original contract", type: "money", numeric: true, inDefault: false },
        { key: "revised_value", label: "Revised contract value", type: "money", numeric: true, inDefault: true },
        { key: "certified", label: "Certified to date", type: "money", numeric: true, inDefault: true },
        { key: "pct_certified", label: "% certified", type: "percent", numeric: true, inDefault: true },
        { key: "paid", label: "Paid to date (net)", type: "money", numeric: true, inDefault: true },
        { key: "unpaid_certified", label: "Certified, not yet paid", type: "money", numeric: true, inDefault: true },
        { key: "overdue_count", label: "Payments overdue", type: "number", numeric: true, inDefault: true },
        { key: "overdue_value", label: "Overdue value", type: "money", numeric: true, inDefault: false },
        { key: "avg_days_late", label: "Average days late", type: "number", numeric: true, inDefault: true, help: "Across payments already made, against the contractual payment date." },
        { key: "retention_held", label: "Retention held", type: "money", numeric: true, inDefault: false },
        { key: "open_changes", label: "Open changes", type: "number", numeric: true, inDefault: true },
        { key: "open_change_value", label: "Open change value", type: "money", numeric: true, inDefault: false },
        { key: "open_claims", label: "Open claims", type: "number", numeric: true, inDefault: true },
        { key: "open_claim_value", label: "Open claim value", type: "money", numeric: true, inDefault: false },
        { key: "bond_status", label: "Bonds & insurance", type: "select", inDefault: true },
        { key: "fa_status", label: "Final account", type: "select", inDefault: true },
        { key: "applications", label: "Payment applications", type: "number", numeric: true, inDefault: false },
        { key: "health", label: "Overall", type: "select", inDefault: true, help: "Watch when payments are overdue, cover has lapsed or certification has passed the contract value." },
      ],
      rows,
    ),

  build: (programmeId) => {
    const db = getDb();
    const today = todayIso();
    const mine = (rows: RecordRow[]) => rows.filter((r) => Number(r.programme_id) === programmeId);
    const contracts = mine(recordsForView(getRegisterDef("contracts")!, db));
    const apps = mine(recordsForView(getRegisterDef("payment_applications")!, db));
    const changes = mine(recordsForView(getRegisterDef("changes")!, db));
    const claims = mine(recordsForView(getRegisterDef("claims")!, db));
    const bonds = mine(recordsForView(getRegisterDef("bonds")!, db));
    const fas = mine(recordsForView(getRegisterDef("final_accounts")!, db));

    return contracts.map((c) => {
      const id = Number(c.id);
      const line = txt(c.cost_line_id__label);
      const contractor = txt(c.contractor_id__label);
      const own = apps.filter((a) => Number(a.contract_id) === id);
      const unpaid = own.filter((a) => !a.paid_date && num(a.net_certified) > 0);
      const overdue = unpaid.filter((a) => a.payment_due_date && daysBetween(today, txt(a.payment_due_date)) < 0);
      const paidApps = own.filter((a) => a.paid_date && a.payment_days_late !== null && a.payment_days_late !== undefined);
      const avgLate = paidApps.length ? Math.round(paidApps.reduce((t, a) => t + num(a.payment_days_late), 0) / paidApps.length) : null;

      // changes and claims are linked by cost line where the contract has one, else by contractor
      const linked = (rows: RecordRow[]) => rows.filter((r) => (c.cost_line_id && r.cost_line_id ? Number(r.cost_line_id) === Number(c.cost_line_id) : txt(r.contractor_id__label) === contractor && !!contractor));
      const openChanges = linked(changes).filter((r) => !CHANGE_CLOSED.includes(txt(r.overall_status_id)));
      const openClaims = linked(claims).filter((r) => !CLAIM_CLOSED.includes(txt(r.status)));

      const myBonds = bonds.filter((b) => (c.cost_line_id && b.cost_line_id ? Number(b.cost_line_id) === Number(c.cost_line_id) : txt(b.contractor_id__label) === contractor && !!contractor));
      const live = myBonds.filter((b) => b.released !== true && b.superseded !== true);
      const expired = live.filter((b) => b.days_to_expiry !== null && Number(b.days_to_expiry) < 0).length;
      const soon = live.filter((b) => b.days_to_expiry !== null && Number(b.days_to_expiry) >= 0 && Number(b.days_to_expiry) <= 30).length;
      const bondStatus = !live.length ? "None held" : expired ? `${expired} expired` : soon ? `${soon} expiring` : "In order";

      const fa = fas.find((f) => (c.cost_line_id && f.cost_line_id ? Number(f.cost_line_id) === Number(c.cost_line_id) : txt(f.contractor_id__label) === contractor && !!contractor));
      const faStatus = txt(fa?.status) || "Not tracked";

      const pct = c.pct_certified === null || c.pct_certified === undefined ? null : Number(c.pct_certified);
      const watch = overdue.length > 0 || expired > 0 || (pct !== null && pct > 100.5);
      const health = watch ? "Watch" : openChanges.length || openClaims.length ? "Open items" : "On track";

      return {
        id,
        contract_ref: line || txt(c.acc_ref) || txt(c.reef_po_no) || txt(c.title),
        contractor,
        package: txt(c.package_id__label),
        status: txt(c.current_status),
        original_value: num(c.original_contract),
        revised_value: num(c.revised_contract_value),
        certified: num(c.net_cum_certified),
        pct_certified: pct,
        paid: num(c.cum_paid),
        unpaid_certified: Math.round(unpaid.reduce((t, a) => t + num(a.net_certified), 0) * 100) / 100,
        overdue_count: overdue.length,
        overdue_value: Math.round(overdue.reduce((t, a) => t + num(a.net_certified), 0) * 100) / 100,
        avg_days_late: avgLate,
        retention_held: Math.round(own.reduce((t, a) => t + num(a.retention_certified), 0) * 100) / 100,
        open_changes: openChanges.length,
        open_change_value: Math.round(openChanges.reduce((t, r) => t + (num(r.dvo_tracker_amount) || num(r.pvo_tracker_amount) || num(r.rfc_tracker_amount)), 0) * 100) / 100,
        open_claims: openClaims.length,
        open_claim_value: Math.round(openClaims.reduce((t, r) => t + num(r.contractor_cost_view), 0) * 100) / 100,
        bond_status: bondStatus,
        fa_status: faStatus,
        applications: own.length,
        health,
        __row_tone: watch ? "amber" : null,
        health__tone: watch ? "amber" : health === "On track" ? "green" : null,
        overdue_count__tone: overdue.length ? "red" : null,
        bond_status__tone: expired ? "red" : soon ? "amber" : null,
      } as RecordRow;
    });
  },
};
