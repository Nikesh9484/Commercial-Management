import type { ReportData } from "./data";
import type { EmailSummary } from "./email";
import type { RecordRow } from "../registers/types";
import { getAccommodationSummary, getCustomsSummary } from "../recovery/summary";
import { formatDate, formatMoney, formatMonthYear } from "../format";
import { APP_NAME } from "../brand";

/**
 * The one-click chase emails of the Cost Recovery module – one per contractor, every contractor
 * with a balance when none is named:
 *  - accommodation: the invoices still unpaid under the construction village lease agreements, one
 *    table per lease agreement (invoice, occupancy period, dates, amount, unpaid, days overdue), the
 *    assessed-not-yet-invoiced note, the late-settlement history and the requests;
 *  - customs: the customs declarations RSG paid on the contractor's imports, the DVO already
 *    recorded for the recovery and the balance still to recover.
 */
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const td = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px"';
const tdr = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;text-align:right;font-family:Consolas,monospace"';
const th = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;background:#f3f5f8;text-align:left"';
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const fileTag = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function buildAccommodationEmail(data: ReportData, sender: { name: string; email?: string }, contractor?: string | null): EmailSummary {
  const acc = getAccommodationSummary(data.recovery.accommodation, data.recovery.accommodationInvoices);
  const groups = contractor ? acc.byContractor.filter((c) => c.contractor === contractor) : acc.byContractor.filter((c) => c.totals.outstanding > 0.5);
  const one = groups.length === 1 ? groups[0] : null;
  const asOfIso = acc.asOf ?? data.period.period_end;
  const asOf = formatDate(asOfIso);
  const outstanding = groups.reduce((t, g) => t + g.totals.outstanding, 0);
  const payBy = formatDate(plusDays(asOfIso, 7));
  const subject = one
    ? `${data.programme.name} (${data.programme.code}) – Construction Village accommodation charges – overdue balance SAR ${formatMoney(one.totals.outstanding)} – ${one.contractor}`
    : `${data.programme.name} (${data.programme.code}) – Construction Village accommodation charges – overdue balances as at ${asOf}`;
  const leaseNames = groups.flatMap((g) => g.rows.map((r) => `${String(r.tracker_name)}${r.asset_ref ? ` (${String(r.asset_ref)})` : ""}`));

  const html: string[] = [];
  const text: string[] = [];
  const both = (h: string, t: string) => {
    html.push(h);
    text.push(t);
  };
  both(`<p>Dear ${esc(one ? one.contractor : "Sir / Madam")},</p>`, `Dear ${one ? one.contractor : "Sir / Madam"},`);
  text.push("", `Subject: ${subject}`, "");
  html.push(`<p><b>Subject: ${esc(subject)}</b></p>`);
  both(
    `<p>Further to the Lease Agreement${leaseNames.length === 1 ? "" : "s"} for accommodation at the AMAALA Construction Village, our records as at ${esc(asOf)} show an overdue balance of <b>SAR ${formatMoney(outstanding)}</b> (inclusive of VAT) against the ${esc(leaseNames.join(", "))} account${leaseNames.length === 1 ? "" : "s"}. The invoices below remain unpaid beyond the 14-day settlement period stated in the lease.</p>`,
    `Further to the Lease Agreement${leaseNames.length === 1 ? "" : "s"} for accommodation at the AMAALA Construction Village, our records as at ${asOf} show an overdue balance of SAR ${formatMoney(outstanding)} (inclusive of VAT) against the ${leaseNames.join(", ")} account${leaseNames.length === 1 ? "" : "s"}. The invoices below remain unpaid beyond the 14-day settlement period stated in the lease.`,
  );
  const notYet: string[] = [];
  const late: number[] = [];
  for (const g of groups) {
    for (const lease of g.rows) {
      const leaseKey = String(lease.tracker_key ?? "").split("|").slice(1).join("|") || String(lease.tracker_key ?? "");
      const mine = g.detail.unpaid.filter((i) => String(i.lease_key ?? "") === leaseKey || String(i.tracker_name ?? "") === String(lease.tracker_name ?? ""));
      const heading = `${String(lease.tracker_name)}${lease.program_name ? ` – ${String(lease.program_name)}` : ""} (outstanding SAR ${formatMoney(n(lease.outstanding))})`;
      if (!mine.length) {
        if (n(lease.outstanding) > 0.5) both(`<p><b>${esc(heading)}</b><br>Invoiced to date SAR ${formatMoney(n(lease.invoiced_gross))} (incl. VAT), received or recovered SAR ${formatMoney(n(lease.received_total))}, withheld under IPC SAR ${formatMoney(n(lease.withheld_in_ipc))}.</p>`, `${heading}: invoiced to date ${formatMoney(n(lease.invoiced_gross))} (incl. VAT), received or recovered ${formatMoney(n(lease.received_total))}, withheld under IPC ${formatMoney(n(lease.withheld_in_ipc))}.`);
        continue;
      }
      const unpaidSum = mine.reduce((t, i) => t + n(i.balance_due), 0);
      const credit = g.detail.overpaid;
      html.push(`<p><b>${esc(heading)}</b></p>`);
      html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:640px"><tr><th ${th}>Invoice no.</th><th ${th}>Occupancy period</th><th ${th}>Invoice date</th><th ${th}>Issued on</th><th ${th}>Due date</th><th ${th}>Amount incl. VAT (SAR)</th><th ${th}>Unpaid (SAR)</th><th ${th}>Days overdue</th></tr>`);
      text.push("", heading, "  Invoice no | Occupancy period | Invoice date | Issued on | Due date | Amount incl. VAT | Unpaid | Days overdue");
      for (const i of mine) {
        const part = i.status === "Part-paid" ? " (part-paid)" : "";
        const days = n(i.days_overdue) > 0 ? String(n(i.days_overdue)) : "due";
        html.push(`<tr><td ${td}>${esc(i.invoice_no)}</td><td ${td}>${esc(formatMonthYear(i.invoice_period as string))}</td><td ${td}>${esc(formatDate(i.invoice_date as string))}</td><td ${td}>${esc(formatDate(i.issued_date as string))}</td><td ${td}>${esc(formatDate(i.due_date as string))}</td><td ${tdr}>${formatMoney(n(i.amount_gross))}</td><td ${tdr}>${formatMoney(n(i.balance_due))}${part}</td><td ${tdr}>${days}</td></tr>`);
        text.push(`  ${String(i.invoice_no ?? "")} | ${formatMonthYear(i.invoice_period as string)} | ${formatDate(i.invoice_date as string)} | ${formatDate(i.issued_date as string)} | ${formatDate(i.due_date as string)} | ${formatMoney(n(i.amount_gross))} | ${formatMoney(n(i.balance_due))}${part} | ${days}`);
      }
      const totalNote = credit > 0.5 ? `${formatMoney(unpaidSum)} less SAR ${formatMoney(credit)} overpaid = <b>${formatMoney(unpaidSum - credit)}</b>` : `<b>${formatMoney(unpaidSum)}</b>`;
      html.push(`<tr><td ${td} colspan="6"><b>Total</b></td><td ${tdr}>${totalNote}</td><td ${td}></td></tr></table>`);
      text.push(`  Total: ${credit > 0.5 ? `${formatMoney(unpaidSum)} less SAR ${formatMoney(credit)} overpaid = ${formatMoney(unpaidSum - credit)}` : formatMoney(unpaidSum)}`);
    }
    if (g.detail.notYetInvoiced > 0.5) notYet.push(`SAR ${formatMoney(g.detail.notYetInvoiced)} (${g.contractor})`);
    if (g.detail.lateHistory.count) late.push(g.detail.lateHistory.min, g.detail.lateHistory.max);
  }
  if (notYet.length) both(`<p>In addition, we have assessed further occupancy at ${esc(notYet.join(" and "))}, net of VAT; these invoices will follow shortly.</p>`, `In addition, we have assessed further occupancy at ${notYet.join(" and ")}, net of VAT; these invoices will follow shortly.`);
  const lateText = late.length ? (Math.min(...late) === Math.max(...late) ? `${Math.max(...late)} days late` : `between ${Math.min(...late)} and ${Math.max(...late)} days late`) : "";
  if (late.length) both(`<p>We note that earlier invoices${groups.length > 1 ? " on these accounts" : ""} were settled ${esc(lateText)}. Timely settlement of accommodation charges is a condition of the Lease Agreement and is separate from, and not contingent on, the progress of Interim Payment Certificates under the main contract.</p>`, `We note that earlier invoices${groups.length > 1 ? " on these accounts" : ""} were settled ${lateText}. Timely settlement of accommodation charges is a condition of the Lease Agreement and is separate from, and not contingent on, the progress of Interim Payment Certificates under the main contract.`);
  both(
    `<p>We request that:</p><ol><li>The full overdue amount of <b>SAR ${formatMoney(outstanding)}</b> is remitted by <b>${esc(payBy)}</b>, with the remittance advice sent to the commercial team and Finance so the receipt is recorded against the invoices listed above.</li><li>Any invoice you consider disputed is raised in writing within 7 days, quoting the invoice number and the grounds, so it can be reviewed with Finance.</li><li>Failing settlement by that date, the balance will be withheld from your next Interim Payment Certificate and recovered by contra-charge in line with the Lease Agreement and the Contract, and any balance still open at final account will be settled within the Final Account Statement.</li></ol>`,
    ["We request that:", `  1. The full overdue amount of SAR ${formatMoney(outstanding)} is remitted by ${payBy}, with the remittance advice sent to the commercial team and Finance so the receipt is recorded against the invoices listed above.`, "  2. Any invoice you consider disputed is raised in writing within 7 days, quoting the invoice number and the grounds, so it can be reviewed with Finance.", "  3. Failing settlement by that date, the balance will be withheld from your next Interim Payment Certificate and recovered by contra-charge in line with the Lease Agreement and the Contract, and any balance still open at final account will be settled within the Final Account Statement."].join("\n"),
  );
  both(`<p>Kind regards,</p><p><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(data.programme.name)} (${esc(data.programme.code)})</p>`, ["", "Kind regards,", sender.name, `Commercial Management – ${data.programme.name} (${data.programme.code})`].join("\n"));
  html.push(`<p style="font-size:11px;color:#6b7280">Prepared with ${esc(APP_NAME)} from the accommodation invoice tracker as at ${esc(asOf)}.</p>`);
  return { subject, to: [], html: `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">${html.join("\n")}</div>`, text: text.join("\r\n"), fileBase: `Accommodation_Charges_${one ? fileTag(one.contractor) : "All"}_${data.programme.code}` };
}

export function buildCustomsEmail(data: ReportData, sender: { name: string; email?: string }, contractor?: string | null): EmailSummary {
  const cus = getCustomsSummary(data.recovery.customs, data.registers.changes?.rows ?? [], data.recovery.customsDeclarations);
  const groups = contractor ? cus.byContractor.filter((c) => c.contractor === contractor) : cus.byContractor.filter((c) => c.totals.stillToRecover > 0.5);
  const one = groups.length === 1 ? groups[0] : null;
  const asOfIso = cus.asOf ?? data.period.period_end;
  const asOf = formatDate(asOfIso);
  const replyBy = formatDate(plusDays(asOfIso, 7));
  const still = groups.reduce((t, g) => t + g.totals.stillToRecover, 0);
  const subject = one
    ? `${data.programme.name} (${data.programme.code}) – Customs duties paid by RSG on your imports – SAR ${formatMoney(one.totals.stillToRecover)} to recover – ${one.contractor}`
    : `${data.programme.name} (${data.programme.code}) – Customs duties paid by RSG – recovery position as at ${asOf}`;
  const html: string[] = [];
  const text: string[] = [];
  const both = (h: string, t: string) => {
    html.push(h);
    text.push(t);
  };
  both(`<p>Dear ${esc(one ? one.contractor : "Sir / Madam")},</p>`, `Dear ${one ? one.contractor : "Sir / Madam"},`);
  text.push("", `Subject: ${subject}`, "");
  html.push(`<p><b>Subject: ${esc(subject)}</b></p>`);
  for (const g of groups) {
    const contracts = [...new Set(g.rows.map((r) => String(r.contract_code ?? "")).filter(Boolean))].join(", ");
    const payer = g.payer || "the Contractor";
    both(
      `<p>Under ${contracts ? `Contract ${esc(contracts)}` : "your Contract"} the customs duties on imported goods are borne by ${esc(payer)}. Our records as at ${esc(asOf)} show that RSG / AMAALA has paid customs duties of <b>SAR ${formatMoney(g.totals.rsgPaid)}</b> on ${esc(g.contractor)}'s imports${g.rsgPaidList.length ? `, on the ${g.rsgPaidList.length} customs declaration${g.rsgPaidList.length === 1 ? "" : "s"} listed below` : ""}.</p>`,
      `Under ${contracts ? `Contract ${contracts}` : "your Contract"} the customs duties on imported goods are borne by ${payer}. Our records as at ${asOf} show that RSG / AMAALA has paid customs duties of SAR ${formatMoney(g.totals.rsgPaid)} on ${g.contractor}'s imports${g.rsgPaidList.length ? `, on the ${g.rsgPaidList.length} customs declaration${g.rsgPaidList.length === 1 ? "" : "s"} listed below` : ""}.`,
    );
    if (g.rsgPaidList.length) {
      html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:640px"><tr><th ${th}>Payment date</th><th ${th}>Bayan no.</th><th ${th}>Port</th><th ${th}>Supplier</th><th ${th}>Invoice no.</th><th ${th}>Customs duty (SAR)</th><th ${th}>Paid by RSG (SAR)</th></tr>`);
      text.push("  Payment date | Bayan no | Port | Supplier | Invoice no | Customs duty | Paid by RSG");
      for (const d of g.rsgPaidList) {
        html.push(`<tr><td ${td}>${esc(formatDate((d.payment_date ?? d.statement_date) as string))}</td><td ${td}>${esc(d.bayan_no)}</td><td ${td}>${esc(d.port)}</td><td ${td}>${esc(d.supplier)}</td><td ${td}>${esc(d.invoice_no)}</td><td ${tdr}>${formatMoney(n(d.customs_duty))}</td><td ${tdr}>${formatMoney(n(d.rsg_paid) || n(d.customs_duty))}</td></tr>`);
        text.push(`  ${formatDate((d.payment_date ?? d.statement_date) as string)} | ${String(d.bayan_no ?? "")} | ${String(d.port ?? "")} | ${String(d.supplier ?? "")} | ${String(d.invoice_no ?? "")} | ${formatMoney(n(d.customs_duty))} | ${formatMoney(n(d.rsg_paid) || n(d.customs_duty))}`);
      }
      html.push(`<tr><td ${td} colspan="6"><b>Total paid by RSG</b></td><td ${tdr}><b>${formatMoney(g.rsgPaidListed)}</b></td></tr></table>`);
      text.push(`  Total paid by RSG: ${formatMoney(g.rsgPaidListed)}`);
    }
    const parts = [`amount to recover SAR ${formatMoney(g.totals.toRecover)}`];
    if (g.totals.recoveredByDvo > 0.5) parts.push(`less SAR ${formatMoney(g.totals.recoveredByDvo)} already recovered through ${g.dvoNote || "the DVO recorded"}`);
    if (g.totals.unrecoverable > 0.5) parts.push(`SAR ${formatMoney(g.totals.unrecoverable)} treated as unrecoverable`);
    both(`<p>Recovery position: ${esc(parts.join("; "))} – <b>balance still to recover SAR ${formatMoney(g.totals.stillToRecover)}</b>.</p>`, `Recovery position: ${parts.join("; ")} – balance still to recover SAR ${formatMoney(g.totals.stillToRecover)}.`);
  }
  both(
    `<p>We request that:</p><ol><li>You confirm the declarations and amounts above, or raise any item you consider disputed in writing with the Bayan number and the grounds, by <b>${esc(replyBy)}</b>.</li><li>The balance of <b>SAR ${formatMoney(still)}</b> is recovered through a Determined Variation Order and deducted from your next Interim Payment Certificate, in line with the Contract; any balance still open at final account will be settled within the Final Account Statement.</li></ol>`,
    ["We request that:", `  1. You confirm the declarations and amounts above, or raise any item you consider disputed in writing with the Bayan number and the grounds, by ${replyBy}.`, `  2. The balance of SAR ${formatMoney(still)} is recovered through a Determined Variation Order and deducted from your next Interim Payment Certificate, in line with the Contract; any balance still open at final account will be settled within the Final Account Statement.`].join("\n"),
  );
  both(`<p>Kind regards,</p><p><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(data.programme.name)} (${esc(data.programme.code)})</p>`, ["", "Kind regards,", sender.name, `Commercial Management – ${data.programme.name} (${data.programme.code})`].join("\n"));
  html.push(`<p style="font-size:11px;color:#6b7280">Prepared with ${esc(APP_NAME)} from the customs recovery tracker as at ${esc(asOf)}.</p>`);
  return { subject, to: [], html: `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">${html.join("\n")}</div>`, text: text.join("\r\n"), fileBase: `Customs_Duties_${one ? fileTag(one.contractor) : "All"}_${data.programme.code}` };
}

export type { RecordRow };
