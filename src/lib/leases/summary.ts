import type Database from "better-sqlite3";
import { getDb } from "../db";
import { todayIso } from "../format";
import { daysBetween } from "../registers/enrich-utils";
import type { RecordRow } from "../registers/types";
import { contractorKey } from "../bonds/name-key";
import { EXPIRY_AMBER_DAYS, EXPIRY_RED_DAYS } from "../registers/defs/bonds";

/**
 * The lease agreements as the tracker chases them: the current expiry and fee (after amendments),
 * what the accommodation invoice tracker holds for the same contractor, the works contract's
 * completion date, and what needs attention.
 */
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function addMonths(iso: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Distinctive words of a contractor's name, for tying a tracker row to the lease by name. */
const words = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !["company", "limited", "contracting", "engineering", "construction", "partners", "saudi", "arabia", "marina", "village", "boutique", "hotel", "island", "hijaz", "triple"].includes(w));
const sameCompany = (a: unknown, b: unknown) => {
  const ka = contractorKey(a);
  const kb = contractorKey(b);
  if (ka && kb && (ka === kb || ka.includes(kb) || kb.includes(ka))) return true;
  const wa = words(a);
  const wb = words(b);
  return wa.length > 0 && wb.length > 0 && wa.some((w) => wb.includes(w));
};

export function enrichLeases(rows: RecordRow[], db: Database.Database = getDb()) {
  if (!rows.length) return;
  const programmeId = Number(rows[0].programme_id);
  const today = todayIso();
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  const recovery = tables.has("accommodation_recovery") ? (db.prepare("SELECT * FROM accommodation_recovery WHERE programme_id = ?").all(programmeId) as RecordRow[]) : [];
  const invoices = tables.has("accommodation_invoices") ? (db.prepare("SELECT * FROM accommodation_invoices WHERE programme_id = ?").all(programmeId) as RecordRow[]) : [];
  const contracts = tables.has("contracts") ? (db.prepare("SELECT id, contractor_id, acc_ref, cost_line_id, original_completion_date, eot_granted_days, current_status FROM contracts WHERE programme_id = ?").all(programmeId) as RecordRow[]) : [];
  const names = new Map((db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
  for (const r of rows) {
    const name = String(r.contractor_id__label ?? names.get(Number(r.contractor_id)) ?? "");
    const code = String(r.contract_code ?? "").toUpperCase();
    // the current position: the latest amendment's fee and expiry, else the original
    if (!r.expiry_date && r.commencement_date && num(r.term_months) > 0) r.expiry_date = addMonths(String(r.commencement_date), num(r.term_months));
    const expiry = String(r.current_expiry || r.expiry_date || "");
    r.current_expiry = expiry || null;
    if (r.current_fee === null || r.current_fee === undefined || r.current_fee === "") r.current_fee = r.lease_fee ?? null;
    // the tracker rows of the same contractor (by our contractor record, else by name)
    const mine = recovery.filter((t) => (r.contractor_id && Number(t.contractor_id) === Number(r.contractor_id)) || sameCompany(t.tracker_name, name));
    const myInvoices = invoices.filter((i) => (r.contractor_id && Number(i.contractor_id) === Number(r.contractor_id)) || sameCompany(i.tracker_name, name));
    r.invoiced_to_date = mine.length ? r2(mine.reduce((t, x) => t + num(x.invoiced_gross), 0)) : null;
    r.outstanding = mine.length ? r2(mine.reduce((t, x) => t + num(x.outstanding), 0)) : null;
    const overdue = myInvoices.filter((i) => (i.status === "Unpaid" || i.status === "Part-paid") && num(i.days_overdue) > 0);
    r.overdue_invoices = overdue.length;
    r.__overdue_value = r2(overdue.reduce((t, i) => t + num(i.balance_due), 0));
    r.__recovery_status = mine.length ? (mine.every((t) => t.status === "Closed") ? "Closed" : "Open") : "";
    // the works contract the lease serves: its revised completion date
    const works = contracts.find((c) => code && String(c.acc_ref ?? "").toUpperCase() === code) ?? contracts.find((c) => Number(c.contractor_id) === Number(r.contractor_id) && (!r.cost_line_id || Number(c.cost_line_id) === Number(r.cost_line_id)));
    const completion = works?.original_completion_date ? addDays(String(works.original_completion_date), num(works.eot_granted_days)) : null;
    r.works_completion = completion;
    r.__works_status = works ? String(works.current_status ?? "") : "";
    const closed = r.status === "Closed" || r.status === "Terminated";
    const days = expiry ? daysBetween(today, expiry) : null;
    r.days_to_expiry = days;
    const alerts: string[] = [];
    let position = closed ? String(r.status) : "Active";
    if (!closed && days !== null) {
      if (days < 0) {
        position = "Expired";
        alerts.push(`Expired ${-days} day(s) ago${r.__works_status === "Active" ? " while the works contract is still active – extend or close the lease" : ""}`);
      } else if (days <= EXPIRY_RED_DAYS) {
        position = "Expiring";
        alerts.push(`Expires in ${days} day(s)`);
      } else if (days <= EXPIRY_AMBER_DAYS) {
        position = "Expiring";
        alerts.push(`Expires in ${days} day(s)`);
      }
    }
    if (!closed && completion && expiry && completion > expiry && r.__works_status !== "Closed" && r.__works_status !== "Completed") {
      position = position === "Expired" ? position : "Extension needed";
      alerts.push(`Works run to ${completion} but the lease ends ${expiry} – an amendment extending the lease is needed`);
    }
    if (!closed && !r.deposit_received && num(r.security_deposit) > 0) alerts.push(`Security deposit of SAR ${num(r.security_deposit).toLocaleString("en-GB", { minimumFractionDigits: 2 })} not recorded as received`);
    if (overdue.length) alerts.push(`${overdue.length} accommodation invoice(s) overdue, SAR ${Number(r.__overdue_value).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
    if (num(r.current_fee) > 0 && num(r.invoiced_to_date) > num(r.current_fee) * 1.15 + 0.5) alerts.push(`Invoiced ${Math.round((num(r.invoiced_to_date) / num(r.current_fee) - 1) * 100)}% above the lease fee – occupancy beyond the histogram, an amendment may be due`);
    if (!closed && position === "Active" && r.__recovery_status === "Closed") alerts.push("The accommodation tracker shows this agreement closed");
    r.lease_status = position;
    r.lease_status__tone = closed ? "grey" : position === "Expired" || position === "Extension needed" ? "red" : position === "Expiring" ? "amber" : "green";
    r.days_to_expiry__tone = closed || days === null ? null : days <= EXPIRY_RED_DAYS ? "red" : days <= EXPIRY_AMBER_DAYS ? "amber" : null;
    r.alerts = alerts.join(" · ");
    r.alerts__tone = alerts.length ? (position === "Expired" || position === "Extension needed" || overdue.length ? "red" : "amber") : null;
    r.__row_tone = closed ? null : position === "Expired" || position === "Extension needed" ? "red" : position === "Expiring" ? "amber" : null;
  }
}

function addDays(iso: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

export interface LeaseAlert {
  id: number;
  agreement_no: string;
  contractor: string;
  contract_code: string;
  expiry: string;
  days: number | null;
  message: string;
  tone: "red" | "amber";
}
export interface LeaseSummary {
  total: number;
  active: number;
  expiring: number;
  expired: number;
  extensionNeeded: number;
  depositMissing: number;
  overdueInvoices: number;
  overdueValue: number;
  currentFee: number;
  invoiced: number;
  outstanding: number;
  alerts: LeaseAlert[];
}

/** The figures and the attention list for a set of (enriched) lease rows. */
export function getLeaseSummary(rows: RecordRow[]): LeaseSummary {
  const s: LeaseSummary = { total: rows.length, active: 0, expiring: 0, expired: 0, extensionNeeded: 0, depositMissing: 0, overdueInvoices: 0, overdueValue: 0, currentFee: 0, invoiced: 0, outstanding: 0, alerts: [] };
  for (const r of rows) {
    const pos = String(r.lease_status ?? "");
    if (pos === "Active" || pos === "Expiring" || pos === "Extension needed") s.active++;
    if (pos === "Expiring") s.expiring++;
    if (pos === "Expired") s.expired++;
    if (pos === "Extension needed") s.extensionNeeded++;
    if (!(r.status === "Closed" || r.status === "Terminated") && !r.deposit_received && num(r.security_deposit) > 0) s.depositMissing++;
    s.overdueInvoices += num(r.overdue_invoices);
    s.overdueValue += num(r.__overdue_value);
    if (!(r.status === "Closed" || r.status === "Terminated")) s.currentFee += num(r.current_fee);
    s.invoiced += num(r.invoiced_to_date);
    s.outstanding += num(r.outstanding);
    if (r.alerts) s.alerts.push({ id: Number(r.id), agreement_no: String(r.agreement_no ?? ""), contractor: String(r.contractor_id__label ?? ""), contract_code: String(r.contract_code ?? ""), expiry: String(r.current_expiry ?? ""), days: r.days_to_expiry === null || r.days_to_expiry === undefined ? null : Number(r.days_to_expiry), message: String(r.alerts), tone: r.alerts__tone === "red" ? "red" : "amber" });
  }
  for (const k of ["overdueValue", "currentFee", "invoiced", "outstanding"] as const) s[k] = r2(s[k]);
  s.alerts.sort((a, b) => (a.tone === b.tone ? (a.days ?? 9e9) - (b.days ?? 9e9) : a.tone === "red" ? -1 : 1));
  return s;
}
