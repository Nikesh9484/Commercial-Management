import { getDb } from "../../db";
import { getRegisterDef } from "../../registers";
import { recordsForView } from "../../view-mode";
import { todayIso } from "../../format";
import { daysBetween } from "../../registers/enrich-utils";
import type { RecordRow } from "../../registers/types";
import { fieldsFrom, type SmartSource } from "./index";

/**
 * Payments due and ageing: every amount certified and not yet paid, put into the bucket that says
 * what to do with it – already overdue, due inside a fortnight, due inside a month, due later, or
 * certified with no invoice yet. VAT is added to the certified amount; withholding tax is deducted
 * (set per contract under Contract settings → Tax on payment).
 */

export const BUCKETS = ["Overdue", "Due within 14 days", "Due within 30 days", "Due later", "Certified – invoice not yet raised"] as const;

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function bucketOf(dueDate: string | null, hasInvoice: boolean, today: string): string {
  if (!dueDate) return hasInvoice ? "Due later" : "Certified – invoice not yet raised";
  const days = daysBetween(today, dueDate);
  if (days < 0) return "Overdue";
  if (days <= 14) return "Due within 14 days";
  if (days <= 30) return "Due within 30 days";
  return "Due later";
}

export const paymentsDue: SmartSource = {
  id: "payments_due",
  title: "Payments due & ageing",
  description: "Everything certified and not yet paid, bucketed into overdue, due within 14 / 30 days, due later, and certified with no invoice – with VAT added or withholding tax deducted, and what is owed in total.",
  ageField: "due_date",
  ageMode: "due",
  defaultColumns: ["bucket", "contract_code", "contractor", "application_no", "net_certified", "tax_type", "tax_amount", "total_due", "due_date", "days"],
  suggestGroupBy: "bucket",
  presets: [
    { id: "overdue", label: "Overdue only", description: "Past the contractual payment date." },
    { id: "urgent", label: "Overdue or due within 14 days", description: "The payments to push through this fortnight." },
    { id: "no_invoice", label: "Certified, no invoice", description: "Certified amounts the contractor has not invoiced." },
  ],

  fields: (rows) =>
    fieldsFrom(
      [
        { key: "bucket", label: "Payment status", type: "select", inDefault: true },
        { key: "contract_code", label: "Contract code", type: "text", inDefault: true },
        { key: "contractor", label: "Contractor / consultant", type: "text", inDefault: true },
        { key: "package", label: "Package", type: "text", inDefault: false },
        { key: "application_no", label: "IPA / IPC reference", type: "text", inDefault: true },
        { key: "month", label: "Payment month", type: "text", inDefault: true },
        { key: "net_certified", label: "Net certified (excl. tax)", type: "money", numeric: true, inDefault: true },
        { key: "tax_type", label: "Tax type", type: "select", inDefault: true },
        { key: "tax_amount", label: "Tax amount", type: "money", numeric: true, inDefault: true },
        { key: "total_due", label: "Total due", type: "money", numeric: true, inDefault: true },
        { key: "invoice_ref", label: "Invoice reference", type: "text", inDefault: false },
        { key: "invoice_date", label: "Invoice date", type: "date", inDefault: false },
        { key: "ipc_date", label: "IPC date", type: "date", inDefault: false },
        { key: "due_date", label: "Payment due date", type: "date", inDefault: true },
        { key: "days", label: "Days overdue / remaining", type: "number", numeric: true, inDefault: true, help: "Negative = overdue by that many days." },
        { key: "ageing", label: "Ageing band", type: "select", inDefault: false },
        { key: "application_date", label: "Application date", type: "date", inDefault: false },
        { key: "retention_held", label: "Retention held this period", type: "money", numeric: true, inDefault: false },
        { key: "advance_recovered", label: "Advance recovered this period", type: "money", numeric: true, inDefault: false },
      ],
      rows,
    ),

  build: (programmeId) => {
    const db = getDb();
    const apps = recordsForView(getRegisterDef("payment_applications")!, db);
    const contracts = recordsForView(getRegisterDef("contracts")!, db);
    const byId = new Map(contracts.map((c) => [Number(c.id), c]));
    const today = todayIso();
    const out: RecordRow[] = [];

    for (const a of apps) {
      if (Number(a.programme_id) !== programmeId) continue;
      if (a.paid_date) continue; // already released
      const netCertified = num(a.net_certified);
      if (netCertified <= 0) continue; // nothing certified in this application
      const c = byId.get(Number(a.contract_id));
      const taxType = txt(c?.tax_type) || "VAT added";
      const rate = c?.vat_pct === null || c?.vat_pct === undefined ? 15 : Number(c.vat_pct);
      const taxAmount = taxType === "No tax" ? 0 : r2(netCertified * (rate / 100));
      const totalDue = taxType === "Withholding tax deducted" ? r2(netCertified - taxAmount) : taxType === "No tax" ? netCertified : r2(netCertified + taxAmount);
      const dueDate = txt(a.payment_due_date) || null;
      const invoiceRef = txt(a.invoice_aconex_ref);
      const hasInvoice = !!invoiceRef || !!a.invoice_date;
      const bucket = bucketOf(dueDate, hasInvoice, today);
      const days = dueDate ? daysBetween(today, dueDate) : null;
      const overdueBy = days === null ? null : -days;
      out.push({
        id: Number(a.id),
        bucket,
        contract_code: txt(c?.cost_line_id__label).split(" ")[0] || txt(c?.acc_ref) || txt(a.contract_id__label),
        contractor: txt(c?.contractor_id__label),
        package: txt(c?.package_id__label),
        application_no: txt(a.application_no),
        month: txt(a.month),
        net_certified: netCertified,
        tax_type: taxType === "Withholding tax deducted" ? `WHT ${rate}%` : taxType === "No tax" ? "None" : `VAT ${rate}%`,
        tax_amount: taxAmount,
        total_due: totalDue,
        invoice_ref: invoiceRef || (hasInvoice ? "" : "Not yet submitted"),
        invoice_date: a.invoice_date ?? null,
        ipc_date: a.ipc_date ?? null,
        due_date: dueDate,
        days,
        ageing: overdueBy === null ? "No due date" : overdueBy <= 0 ? "Not yet due" : overdueBy <= 30 ? "1–30 days overdue" : overdueBy <= 60 ? "31–60 days overdue" : overdueBy <= 90 ? "61–90 days overdue" : "Over 90 days overdue",
        application_date: a.application_date ?? null,
        retention_held: num(a.retention_certified),
        advance_recovered: Math.abs(num(a.advance_recovery_certified)),
        __row_tone: bucket === "Overdue" ? "red" : bucket === "Due within 14 days" ? "amber" : null,
        days__tone: days === null ? null : days < 0 ? "red" : days <= 14 ? "amber" : null,
      });
    }
    // worst first: overdue by the longest, then soonest due
    const order = new Map(BUCKETS.map((b, i) => [b as string, i]));
    out.sort((a, b) => (order.get(String(a.bucket)) ?? 9) - (order.get(String(b.bucket)) ?? 9) || (Number(a.days ?? 9e9) - Number(b.days ?? 9e9)));
    return out;
  },
};
